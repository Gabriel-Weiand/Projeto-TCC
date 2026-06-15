import { DateTime } from 'luxon'
import type User from '#models/user'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Machine from '#models/machine'
import { summarizeAllocation } from '#services/allocation/summarizer'
import { serializeAllocationMetric } from '#services/telemetry/api_format'
import {
  canSeeAllocationOwnerNames,
  resolveInitialAllocationStatus,
} from '#services/lab/config'
import {
  validateAllocationSchedule,
  type ScheduleValidationError,
} from '#services/allocation/schedule'
import { resolveAccessPhase } from '#services/allocation/access'
import { findAllocationConflict } from '#services/allocation/conflict'
import {
  isLifecycleFilter,
  resolveLifecycleStatus,
  serializeAllocation,
  serializeAllocationPage,
} from '#services/allocation/lifecycle'
import {
  notifyAdminsPendingAllocation,
  notifyAllocationFinishedByUser,
  notifyAllocationStatusChange,
  notifySessionSummaryReady,
} from '#services/notification/notification_service'
import { parseUtcFromIso } from '#utils/datetime'
import {
  canChangeAllocationHomeMount,
  resolveAllocationHomeMountForCreate,
} from '#services/allocation/home_mount'
import {
  buildOccupiedMachineIds,
  resolveEffectiveMachineStatus,
} from '#services/machine/effective_status'
import { DomainError } from '#services/shared/domain_error'
import type { Infer } from '@vinejs/vine/types'
import type {
  createAllocationValidator,
  updateAllocationValidator,
  listAllocationsValidator,
  extendAllocationValidator,
} from '#validators/allocation'

type CreateAllocationPayload = Infer<typeof createAllocationValidator>
type UpdateAllocationPayload = Infer<typeof updateAllocationValidator>
type ListAllocationsFilters = Infer<typeof listAllocationsValidator>
type ExtendAllocationPayload = Infer<typeof extendAllocationValidator>

function throwScheduleError(error: ScheduleValidationError): never {
  throw new DomainError(error.code, error.message, 400)
}

function assertSchedule(
  startTime: DateTime,
  endTime: DateTime,
  options?: Parameters<typeof validateAllocationSchedule>[2]
) {
  const error = validateAllocationSchedule(startTime, endTime, options)
  if (error) throwScheduleError(error)
}

async function paginateWithLifecycleFilter(
  query: ReturnType<typeof Allocation.query>,
  lifecycleStatus: string,
  page: number,
  limit: number
) {
  const rows = await query
  const filtered = rows.filter((a) => resolveLifecycleStatus(a) === lifecycleStatus)
  const start = (page - 1) * limit
  const slice = filtered.slice(start, start + limit)

  return {
    meta: {
      total: filtered.length,
      perPage: limit,
      currentPage: page,
      lastPage: Math.max(1, Math.ceil(filtered.length / limit)),
    },
    data: slice.map((a) => serializeAllocation(a)),
  }
}

function assertAllocationOwner(user: User, allocation: Allocation, message: string) {
  if (user.role !== 'admin' && allocation.userId !== user.id) {
    throw new DomainError('NOT_OWNER', message, 403)
  }
}

export const AllocationService = {
  async listMyAllocations(user: User, filters: ListAllocationsFilters) {
    const { status, lifecycleStatus, page = 1, limit = 20 } = filters

    let query = Allocation.query()
      .where('userId', user.id)
      .where('userHidden', false)
      .preload('machine', (machineQuery) => machineQuery.preload('group'))
      .orderBy('startTime', 'desc')

    if (status) {
      query = query.where('status', status)
    }

    if (lifecycleStatus && isLifecycleFilter(lifecycleStatus)) {
      return paginateWithLifecycleFilter(query, lifecycleStatus, page, limit)
    }

    const allocations = await query.paginate(page, limit)
    return serializeAllocationPage(allocations)
  },

  async listAllocations(user: User, filters: ListAllocationsFilters) {
    const {
      userId,
      machineId,
      status,
      lifecycleStatus,
      userHidden,
      page = 1,
      limit = 20,
    } = filters

    let query = Allocation.query()
      .preload('user')
      .preload('machine')
      .preload('metric')
      .orderBy('startTime', 'desc')

    if (user.role !== 'admin') {
      query = query.where('userId', user.id).where('userHidden', false)
    } else {
      if (userId) query = query.where('userId', userId)
      if (userHidden === true) {
        query = query.where('userHidden', true)
      } else {
        query = query.where('userHidden', false)
      }
    }

    if (machineId) query = query.where('machineId', machineId)
    if (status) query = query.where('status', status)

    if (lifecycleStatus && isLifecycleFilter(lifecycleStatus)) {
      return paginateWithLifecycleFilter(query, lifecycleStatus, page, limit)
    }

    const allocations = await query.paginate(page, limit)
    return serializeAllocationPage(allocations)
  },

  async createAllocation(user: User, data: CreateAllocationPayload) {
    data.startTime = data.startTime.toUTC()
    data.endTime = data.endTime.toUTC()

    assertSchedule(data.startTime, data.endTime)

    const machine = await Machine.findOrFail(data.machineId)
    const occupiedMachineIds = await buildOccupiedMachineIds()
    const effectiveStatus = resolveEffectiveMachineStatus(machine, occupiedMachineIds)

    if (
      effectiveStatus === 'maintenance' ||
      effectiveStatus === 'offline' ||
      effectiveStatus === 'disabled'
    ) {
      throw new DomainError(
        'MACHINE_IN_MAINTENANCE',
        'A máquina selecionada está em manutenção ou offline.',
        400
      )
    }

    const conflict = await findAllocationConflict(data.machineId, data.startTime, data.endTime)
    if (conflict) {
      throw new DomainError(
        'ALLOCATION_CONFLICT',
        'Já existe uma reserva ativa para esta máquina neste horário.',
        409
      )
    }

    if (user.role !== 'admin') {
      data.userId = user.id
      data.status = resolveInitialAllocationStatus('user')
    } else {
      if (!data.userId) data.userId = user.id
      data.status = resolveInitialAllocationStatus('admin', data.status)
    }

    const homeResolved = resolveAllocationHomeMountForCreate(machine, data.homeMountpoint)
    if (homeResolved.error) {
      throw new DomainError('INVALID_HOME_MOUNT', homeResolved.error, 400)
    }
    data.homeMountpoint = homeResolved.homeMountpoint

    const allocation = await Allocation.create(data)
    await allocation.load('machine')
    await notifyAdminsPendingAllocation(allocation, machine)

    return serializeAllocation(allocation)
  },

  async extendAllocation(user: User, allocationId: number, payload: ExtendAllocationPayload) {
    const allocation = await Allocation.findOrFail(allocationId)
    const { additionalMinutes, endTime } = payload

    if (!additionalMinutes && !endTime) {
      throw new DomainError(
        'MISSING_EXTEND_PARAMS',
        'Informe additionalMinutes ou endTime.',
        400
      )
    }

    if (user.role !== 'admin' && allocation.userId !== user.id) {
      throw new DomainError('NOT_OWNER', 'Apenas o dono pode estender a alocação.', 403)
    }

    if (allocation.status !== 'approved') {
      throw new DomainError(
        'INVALID_STATUS',
        'Apenas alocações ativas podem ser estendidas.',
        400
      )
    }

    const now = DateTime.utc()
    const end = allocation.endTime
    const phase = resolveAccessPhase(allocation, now)

    if (!['none', 'prepare', 'active', 'grace'].includes(phase)) {
      throw new DomainError(
        'INVALID_PHASE',
        'Não é possível estender nesta fase. Estenda antes do início, durante a sessão ou no grace.',
        400
      )
    }

    let newEnd: DateTime
    if (endTime) {
      try {
        newEnd = parseUtcFromIso(endTime)
      } catch {
        throw new DomainError('INVALID_END_TIME', 'Horário de término inválido.', 400)
      }
      if (newEnd <= end) {
        throw new DomainError(
          'INVALID_RANGE',
          'A nova finalização deve ser posterior ao fim atual da reserva.',
          400
        )
      }
    } else {
      newEnd = end.plus({ minutes: additionalMinutes! })
    }

    assertSchedule(allocation.startTime, newEnd, { allowPastStart: true })

    const conflict = await findAllocationConflict(
      allocation.machineId,
      allocation.startTime,
      newEnd,
      allocation.id
    )

    if (conflict) {
      throw new DomainError(
        'ALLOCATION_CONFLICT',
        'A extensão conflita com outra reserva nesta máquina.',
        409
      )
    }

    allocation.endTime = newEnd
    await allocation.save()
    await allocation.load('machine')

    return serializeAllocation(allocation)
  },

  async finishAllocation(user: User, allocationId: number) {
    const allocation = await Allocation.findOrFail(allocationId)

    if (user.role !== 'admin' && allocation.userId !== user.id) {
      throw new DomainError('NOT_OWNER', 'Apenas o dono pode finalizar a alocação.', 403)
    }

    if (allocation.status !== 'approved') {
      throw new DomainError(
        'INVALID_STATUS',
        'Apenas alocações aprovadas podem ser finalizadas.',
        400
      )
    }

    const now = DateTime.utc()
    if (now.toMillis() < allocation.startTime.toMillis()) {
      throw new DomainError(
        'NOT_STARTED',
        'A alocação ainda não começou. Use cancelar em vez de finalizar.',
        400
      )
    }

    allocation.endTime = now
    allocation.status = 'finished'
    await allocation.save()
    await allocation.load('machine')
    await allocation.load('user')
    await notifyAllocationFinishedByUser(allocation, allocation.machine)

    return serializeAllocation(allocation)
  },

  async updateAllocation(user: User, allocationId: number, data: UpdateAllocationPayload) {
    const allocation = await Allocation.findOrFail(allocationId)

    if (user.role !== 'admin') {
      if (allocation.userId !== user.id) {
        throw new DomainError(
          'NOT_OWNER',
          'Você só pode alterar suas próprias alocações.',
          403
        )
      }

      if (data.status && data.status !== 'cancelled') {
        throw new DomainError(
          'INVALID_STATUS_CHANGE',
          'Você só pode cancelar suas alocações.',
          403
        )
      }

      if (data.status === 'cancelled' && !['approved', 'pending'].includes(allocation.status)) {
        throw new DomainError(
          'CANNOT_CANCEL',
          'Só é possível cancelar alocações com status pendente ou aprovado.',
          403
        )
      }

      if (data.status === 'cancelled') {
        const now = DateTime.utc()
        if (now.toMillis() >= allocation.startTime.toMillis()) {
          throw new DomainError(
            'CANNOT_CANCEL_AFTER_START',
            'Não é possível cancelar após o início. Use finalizar a sessão.',
            400
          )
        }
      }

      if (data.startTime || data.endTime) {
        throw new DomainError(
          'CANNOT_CHANGE_TIME',
          'Você não pode alterar os horários da alocação.',
          403
        )
      }
    }

    if (user.role === 'admin' && (data.startTime || data.endTime)) {
      if (allocation.status === 'finished') {
        throw new DomainError(
          'CANNOT_CHANGE_FINISHED_TIMES',
          'Não é possível alterar horários de alocações já finalizadas.',
          400
        )
      }

      const newStart = (data.startTime ?? allocation.startTime).toUTC()
      const newEnd = (data.endTime ?? allocation.endTime).toUTC()

      assertSchedule(newStart, newEnd, {
        allowPastStart: data.startTime === undefined,
      })

      const conflict = await findAllocationConflict(
        allocation.machineId,
        newStart,
        newEnd,
        allocation.id
      )

      if (conflict) {
        throw new DomainError(
          'ALLOCATION_CONFLICT',
          'O novo horário conflita com outra reserva nesta máquina.',
          409
        )
      }

      allocation.startTime = newStart
      allocation.endTime = newEnd
      delete data.startTime
      delete data.endTime
    }

    const previousStatus = allocation.status

    if (data.homeMountpoint !== undefined) {
      if (user.role !== 'admin') {
        throw new DomainError(
          'CANNOT_CHANGE_HOME_MOUNT',
          'Somente administradores podem alterar o disco da alocação.',
          403
        )
      }
      if (!canChangeAllocationHomeMount(allocation)) {
        throw new DomainError(
          'HOME_MOUNT_LOCKED',
          'O disco só pode ser alterado enquanto a reserva está aprovada e ainda não começou.',
          400
        )
      }
      await allocation.load('machine')
      const homeResolved = resolveAllocationHomeMountForCreate(
        allocation.machine,
        data.homeMountpoint
      )
      if (homeResolved.error) {
        throw new DomainError('INVALID_HOME_MOUNT', homeResolved.error, 400)
      }
      data.homeMountpoint = homeResolved.homeMountpoint
    }

    allocation.merge(data)
    await allocation.save()
    await allocation.load('user')
    await allocation.load('machine')
    await notifyAllocationStatusChange(allocation, allocation.machine, previousStatus)

    return serializeAllocation(allocation)
  },

  async softDeleteAllocation(user: User, allocationId: number) {
    const allocation = await Allocation.findOrFail(allocationId)

    if (user.role !== 'admin' && allocation.userId !== user.id) {
      throw new DomainError(
        'NOT_OWNER',
        'Você só pode remover suas próprias alocações.',
        403
      )
    }

    const now = Date.now()
    const startMs = allocation.startTime.toMillis()
    const endMs = allocation.endTime.toMillis()

    if (now >= startMs && endMs > now && ['approved'].includes(allocation.status)) {
      throw new DomainError(
        'ALLOCATION_IN_PROGRESS',
        'Não é possível remover uma alocação em andamento.',
        403
      )
    }

    const previousStatus = allocation.status

    if (['pending', 'approved'].includes(allocation.status) && now < startMs) {
      allocation.status = 'cancelled'
    }

    allocation.userHidden = true
    await allocation.save()
    await allocation.load('machine')

    if (allocation.status !== previousStatus) {
      await notifyAllocationStatusChange(allocation, allocation.machine, previousStatus)
    }

    return {
      message: 'Alocação removida do seu histórico.',
      id: allocation.id,
      status: allocation.status,
    }
  },

  async machineHistory(user: User, machineId: number, page: number, limit: number) {
    const showOwnerNames = canSeeAllocationOwnerNames(user.role)

    const query = Allocation.query()
      .where('machineId', machineId)
      .preload('metric')
      .orderBy('startTime', 'desc')

    if (showOwnerNames) {
      query.preload('user')
    }

    const allocations = await query.paginate(page, limit)

    if (user.role === 'admin') {
      return allocations
    }

    const serialized = allocations.serialize()
    serialized.data = serialized.data.map((allocation: Record<string, unknown>) => {
      const row: Record<string, unknown> = {
        id: allocation.id,
        machineId: allocation.machineId,
        startTime: allocation.startTime,
        endTime: allocation.endTime,
        status: allocation.status,
        isOwn: allocation.userId === user.id,
      }
      if (showOwnerNames && allocation.user) {
        const u = allocation.user as { id: number; fullName: string }
        row.user = { id: u.id, fullName: u.fullName }
      }
      return row
    })

    return serialized
  },

  async summarizeSession(allocationId: number) {
    const allocation = await Allocation.findOrFail(allocationId)
    await allocation.load('machine')

    const existing = await AllocationMetric.findBy('allocationId', allocation.id)
    if (existing) {
      throw new DomainError(
        'SUMMARY_EXISTS',
        'Esta alocação já possui um resumo.',
        409
      )
    }

    const metric = await summarizeAllocation(allocation)
    if (!metric) {
      throw new DomainError(
        'NO_TELEMETRY',
        'Não há dados de telemetria para este período.',
        404
      )
    }

    await notifySessionSummaryReady(allocation, allocation.machine)
    return serializeAllocationMetric(metric)
  },

  async getSessionSummary(user: User, allocationId: number) {
    const allocation = await Allocation.findOrFail(allocationId)

    assertAllocationOwner(
      user,
      allocation,
      'Você só pode visualizar o resumo das suas próprias alocações.'
    )

    await allocation.load('metric')

    if (!allocation.metric) {
      throw new DomainError(
        'NO_SUMMARY',
        'Esta alocação ainda não possui um resumo.',
        404
      )
    }

    return serializeAllocationMetric(allocation.metric)
  },
}
