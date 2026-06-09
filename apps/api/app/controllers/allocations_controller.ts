import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Machine from '#models/machine'
import { summarizeAllocation } from '#services/allocation_summarizer'
import { serializeAllocationMetric } from '#services/telemetry_api_format'
import {
  createAllocationValidator,
  updateAllocationValidator,
  listAllocationsValidator,
} from '#validators/allocation'
import { extendAllocationValidator } from '#validators/allocation'
import {
  canSeeAllocationOwnerNames,
  resolveInitialAllocationStatus,
} from '#services/lab_config'
import { validateAllocationSchedule } from '#services/allocation_schedule'
import { resolveAccessPhase } from '#services/allocation_access'
import { findAllocationConflict } from '#services/allocation_conflict'
import {
  isLifecycleFilter,
  resolveLifecycleStatus,
  serializeAllocation,
  serializeAllocationPage,
} from '#services/allocation_lifecycle'
import {
  notifyAdminsPendingAllocation,
  notifyAllocationFinishedByUser,
  notifyAllocationStatusChange,
  notifySessionSummaryReady,
} from '#services/notification_service'
import { parseUtcFromIso } from '#utils/datetime'
import {
  canChangeAllocationHomeMount,
  resolveAllocationHomeMountForCreate,
} from '#services/allocation_home_mount'
import {
  buildOccupiedMachineIds,
  resolveEffectiveMachineStatus,
} from '#services/machine_effective_status'

export default class AllocationsController {
  /**
   * Lista apenas as alocações do utilizador autenticado.
   * GET /api/v1/allocations/my
   */
  async myAllocations({ auth, request, response }: HttpContext) {
    const user = auth.user!

    const { status, lifecycleStatus, page = 1, limit = 20 } =
      await request.validateUsing(listAllocationsValidator)

    let query = Allocation.query()
      .where('userId', user.id)
      .where('userHidden', false)
      .preload('machine', (machineQuery) => machineQuery.preload('group'))
      .orderBy('startTime', 'desc')

    if (status) {
      query = query.where('status', status)
    }

    if (lifecycleStatus && isLifecycleFilter(lifecycleStatus)) {
      const rows = await query
      const filtered = rows.filter((a) => resolveLifecycleStatus(a) === lifecycleStatus)
      const start = (page - 1) * limit
      const slice = filtered.slice(start, start + limit)
      return response.ok({
        meta: {
          total: filtered.length,
          perPage: limit,
          currentPage: page,
          lastPage: Math.max(1, Math.ceil(filtered.length / limit)),
        },
        data: slice.map((a) => serializeAllocation(a)),
      })
    }

    const allocations = await query.paginate(page, limit)
    return response.ok(serializeAllocationPage(allocations))
  }

  /**
   * Lista alocações com filtros opcionais.
   * - User normal: vê apenas suas próprias alocações
   * - Admin: vê todas
   *
   * GET /api/v1/allocations
   */
  async index({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const {
      userId,
      machineId,
      status,
      lifecycleStatus,
      userHidden,
      page = 1,
      limit = 20,
    } = await request.validateUsing(listAllocationsValidator)

    let query = Allocation.query()
      .preload('user')
      .preload('machine')
      .preload('metric')
      .orderBy('startTime', 'desc')

    // User normal só vê suas próprias alocações (excluindo as ocultas)
    if (user.role !== 'admin') {
      query = query.where('userId', user.id).where('userHidden', false)
    } else {
      if (userId) query = query.where('userId', userId)
      // Lista operacional: sem ocultas; ?userHidden=true → apenas removidas pelo usuário
      if (userHidden === true) {
        query = query.where('userHidden', true)
      } else {
        query = query.where('userHidden', false)
      }
    }

    if (machineId) query = query.where('machineId', machineId)
    if (status) query = query.where('status', status)

    if (lifecycleStatus && isLifecycleFilter(lifecycleStatus)) {
      const rows = await query
      const filtered = rows.filter((a) => resolveLifecycleStatus(a) === lifecycleStatus)
      const start = (page - 1) * limit
      const slice = filtered.slice(start, start + limit)
      return response.ok({
        meta: {
          total: filtered.length,
          perPage: limit,
          currentPage: page,
          lastPage: Math.max(1, Math.ceil(filtered.length / limit)),
        },
        data: slice.map((a) => serializeAllocation(a)),
      })
    }

    const allocations = await query.paginate(page, limit)
    return response.ok(serializeAllocationPage(allocations))
  }

  /**
   * Cria uma nova alocação.
   * Realiza validações de manutenção e conflito de horário (UTC).
   * * POST /api/v1/allocations
   */
  async store({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(createAllocationValidator)

    // Forçar UTC para garantir consistência absoluta no banco (SQLite/Postgres)
    data.startTime = data.startTime.toUTC()
    data.endTime = data.endTime.toUTC()

    const scheduleError = validateAllocationSchedule(data.startTime, data.endTime)
    if (scheduleError) {
      return response.badRequest(scheduleError)
    }

    // 1. Verificação de Status da Máquina (modo admin + status efetivo)
    const machine = await Machine.findOrFail(data.machineId)
    const occupiedMachineIds = await buildOccupiedMachineIds()
    const effectiveStatus = resolveEffectiveMachineStatus(machine, occupiedMachineIds)
    if (effectiveStatus === 'maintenance' || effectiveStatus === 'offline' || effectiveStatus === 'disabled') {
      return response.badRequest({
        code: 'MACHINE_IN_MAINTENANCE',
        message: 'A máquina selecionada está em manutenção ou offline.',
      })
    }

    const conflict = await findAllocationConflict(data.machineId, data.startTime, data.endTime)

    if (conflict) {
      return response.conflict({
        code: 'ALLOCATION_CONFLICT',
        message: 'Já existe uma reserva ativa para esta máquina neste horário.',
      })
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
      return response.badRequest({ code: 'INVALID_HOME_MOUNT', message: homeResolved.error })
    }
    data.homeMountpoint = homeResolved.homeMountpoint

    const allocation = await Allocation.create(data)
    await allocation.load('machine')
    await notifyAdminsPendingAllocation(allocation, machine)

    return response.created(serializeAllocation(allocation))
  }

  /**
   * Estende o fim da reserva: antes do início, em sessão ativa ou no grace (não em SFTP).
   * POST /api/v1/allocations/:id/extend
   */
  async extend({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)
    const { additionalMinutes, endTime } = await request.validateUsing(extendAllocationValidator)

    if (!additionalMinutes && !endTime) {
      return response.badRequest({
        message: 'Informe additionalMinutes ou endTime.',
      })
    }

    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({ message: 'Apenas o dono pode estender a alocação.' })
    }

    if (allocation.status !== 'approved') {
      return response.badRequest({ message: 'Apenas alocações ativas podem ser estendidas.' })
    }

    const now = DateTime.utc()
    const end = allocation.endTime
    const phase = resolveAccessPhase(allocation, now)

    if (!['none', 'prepare', 'active', 'grace'].includes(phase)) {
      return response.badRequest({
        message:
          'Não é possível estender nesta fase. Estenda antes do início, durante a sessão ou no grace.',
      })
    }

    let newEnd: DateTime
    if (endTime) {
      try {
        newEnd = parseUtcFromIso(endTime)
      } catch {
        return response.badRequest({
          code: 'INVALID_END_TIME',
          message: 'Horário de término inválido.',
        })
      }
      if (newEnd <= end) {
        return response.badRequest({
          code: 'INVALID_RANGE',
          message: 'A nova finalização deve ser posterior ao fim atual da reserva.',
        })
      }
    } else {
      newEnd = end.plus({ minutes: additionalMinutes! })
    }
    const scheduleError = validateAllocationSchedule(allocation.startTime, newEnd, {
      allowPastStart: true,
    })
    if (scheduleError) {
      return response.badRequest(scheduleError)
    }

    const conflict = await findAllocationConflict(
      allocation.machineId,
      allocation.startTime,
      newEnd,
      allocation.id
    )

    if (conflict) {
      return response.conflict({
        code: 'ALLOCATION_CONFLICT',
        message: 'A extensão conflita com outra reserva nesta máquina.',
      })
    }

    allocation.endTime = newEnd
    await allocation.save()
    await allocation.load('machine')

    return response.ok(serializeAllocation(allocation))
  }

  /**
   * Finaliza antecipadamente uma sessão aprovada (pula grace e SFTP pós-sessão).
   * POST /api/v1/allocations/:id/finish
   */
  async finish({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)

    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({ message: 'Apenas o dono pode finalizar a alocação.' })
    }

    if (allocation.status !== 'approved') {
      return response.badRequest({ message: 'Apenas alocações aprovadas podem ser finalizadas.' })
    }

    const now = DateTime.utc()
    if (now.toMillis() < allocation.startTime.toMillis()) {
      return response.badRequest({
        message: 'A alocação ainda não começou. Use cancelar em vez de finalizar.',
      })
    }

    allocation.endTime = now
    allocation.status = 'finished'
    await allocation.save()
    await allocation.load('machine')
    await allocation.load('user')
    await notifyAllocationFinishedByUser(allocation, allocation.machine)

    return response.ok(serializeAllocation(allocation))
  }

  /**
   * Atualiza uma alocação (status, horário, etc).
   * - User normal: só pode cancelar suas próprias alocações (approved → cancelled)
   * - Admin: pode alterar qualquer alocação para qualquer status
   *
   * PATCH /api/v1/allocations/:id
   */
  async update({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)
    const data = await request.validateUsing(updateAllocationValidator)

    // Regras para usuário normal
    if (user.role !== 'admin') {
      // Só pode alterar suas próprias alocações
      if (allocation.userId !== user.id) {
        return response.forbidden({
          code: 'NOT_OWNER',
          message: 'Você só pode alterar suas próprias alocações.',
        })
      }

      // Só pode cancelar (não pode mudar para outros status)
      if (data.status && data.status !== 'cancelled') {
        return response.forbidden({
          code: 'INVALID_STATUS_CHANGE',
          message: 'Você só pode cancelar suas alocações.',
        })
      }

      // Só pode cancelar se estiver pendente ou aprovada
      if (data.status === 'cancelled' && !['approved', 'pending'].includes(allocation.status)) {
        return response.forbidden({
          code: 'CANNOT_CANCEL',
          message: 'Só é possível cancelar alocações com status pendente ou aprovado.',
        })
      }

      if (data.status === 'cancelled') {
        const now = DateTime.utc()
        if (now.toMillis() >= allocation.startTime.toMillis()) {
          return response.badRequest({
            code: 'CANNOT_CANCEL_AFTER_START',
            message: 'Não é possível cancelar após o início. Use finalizar a sessão.',
          })
        }
      }

      // User normal não pode alterar horários
      if (data.startTime || data.endTime) {
        return response.forbidden({
          code: 'CANNOT_CHANGE_TIME',
          message: 'Você não pode alterar os horários da alocação.',
        })
      }
    }

    if (user.role === 'admin' && (data.startTime || data.endTime)) {
      if (allocation.status === 'finished') {
        return response.badRequest({
          code: 'CANNOT_CHANGE_FINISHED_TIMES',
          message: 'Não é possível alterar horários de alocações já finalizadas.',
        })
      }

      const newStart = (data.startTime ?? allocation.startTime).toUTC()
      const newEnd = (data.endTime ?? allocation.endTime).toUTC()

      const scheduleError = validateAllocationSchedule(newStart, newEnd, {
        allowPastStart: data.startTime === undefined,
      })
      if (scheduleError) {
        return response.badRequest(scheduleError)
      }

      const conflict = await findAllocationConflict(
        allocation.machineId,
        newStart,
        newEnd,
        allocation.id
      )
      if (conflict) {
        return response.conflict({
          code: 'ALLOCATION_CONFLICT',
          message: 'O novo horário conflita com outra reserva nesta máquina.',
        })
      }

      allocation.startTime = newStart
      allocation.endTime = newEnd
      delete data.startTime
      delete data.endTime
    }

    const previousStatus = allocation.status

    if (data.homeMountpoint !== undefined) {
      if (user.role !== 'admin') {
        return response.forbidden({
          code: 'CANNOT_CHANGE_HOME_MOUNT',
          message: 'Somente administradores podem alterar o disco da alocação.',
        })
      }
      if (!canChangeAllocationHomeMount(allocation)) {
        return response.badRequest({
          code: 'HOME_MOUNT_LOCKED',
          message: 'O disco só pode ser alterado enquanto a reserva está aprovada e ainda não começou.',
        })
      }
      await allocation.load('machine')
      const homeResolved = resolveAllocationHomeMountForCreate(
        allocation.machine,
        data.homeMountpoint
      )
      if (homeResolved.error) {
        return response.badRequest({ code: 'INVALID_HOME_MOUNT', message: homeResolved.error })
      }
      data.homeMountpoint = homeResolved.homeMountpoint
    }

    allocation.merge(data)
    await allocation.save()

    await allocation.load('user')
    await allocation.load('machine')
    await notifyAllocationStatusChange(allocation, allocation.machine, previousStatus)

    return response.ok(serializeAllocation(allocation))
  }

  /**
   * Soft-delete de uma alocação pelo usuário.
   * Oculta a alocação do histórico do usuário e da lista operacional do admin;
   * o registro permanece consultável em GET /allocations?userHidden=true (admin).
   * - Se a alocação está pendente/aprovada e ainda não começou → cancela + oculta
   * - Se a alocação já foi finalizada/cancelada/negada → apenas oculta
   * - Não permite ocultar alocação em andamento
   *
   * DELETE /api/v1/allocations/:id
   */
  async softDelete({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)

    // Verificar propriedade (admin pode fazer soft-delete em qualquer uma)
    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({
        code: 'NOT_OWNER',
        message: 'Você só pode remover suas próprias alocações.',
      })
    }

    const now = Date.now()
    const startMs = allocation.startTime.toMillis()
    const endMs = allocation.endTime.toMillis()

    // Verificar se está em andamento (já começou mas não terminou)
    if (now >= startMs && now < endMs && ['approved'].includes(allocation.status)) {
      return response.forbidden({
        code: 'ALLOCATION_IN_PROGRESS',
        message: 'Não é possível remover uma alocação em andamento.',
      })
    }

    const previousStatus = allocation.status

    // Se pendente ou aprovada e ainda não começou → cancela automaticamente
    if (['pending', 'approved'].includes(allocation.status) && now < startMs) {
      allocation.status = 'cancelled'
    }

    allocation.userHidden = true
    await allocation.save()
    await allocation.load('machine')
    if (allocation.status !== previousStatus) {
      await notifyAllocationStatusChange(allocation, allocation.machine, previousStatus)
    }

    return response.ok({
      message: 'Alocação removida do seu histórico.',
      id: allocation.id,
      status: allocation.status,
    })
  }

  /**
   * Histórico de alocações de um usuário.
   *
   * GET /api/v1/users/:id/allocations
   */
  async userHistory({ params, request, response }: HttpContext) {
    const { page = 1, limit = 20 } = request.qs()

    const allocations = await Allocation.query()
      .where('userId', params.id)
      .preload('machine')
      .preload('metric')
      .orderBy('startTime', 'desc')
      .paginate(page, limit)

    return response.ok(allocations)
  }

  /**
   * Histórico de alocações de uma máquina.
   * - Admin: vê tudo (usuário, motivo, métricas)
   * - User: horários + isOwn; nomes se LAB_ALLOCATION_PUBLIC_NAMES=true
   *
   * GET /api/v1/machines/:id/allocations
   */
  async machineHistory({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const { page = 1, limit = 20 } = request.qs()
    const showOwnerNames = canSeeAllocationOwnerNames(user.role)

    const query = Allocation.query()
      .where('machineId', params.id)
      .preload('metric')
      .orderBy('startTime', 'desc')

    if (showOwnerNames) {
      query.preload('user')
    }

    const allocations = await query.paginate(page, limit)

    if (user.role === 'admin') {
      return response.ok(allocations)
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
    return response.ok(serialized)
  }

  /**
   * Gera resumo/métricas de uma sessão (alocação).
   * Consolida telemetrias do período em AllocationMetric.
   *
   * POST /api/v1/allocations/:id/summary
   */
  async summarizeSession({ params, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await allocation.load('machine')

    // Verifica se já existe métrica
    const existing = await AllocationMetric.findBy('allocationId', allocation.id)
    if (existing) {
      return response.conflict({
        code: 'SUMMARY_EXISTS',
        message: 'Esta alocação já possui um resumo.',
      })
    }

    const metric = await summarizeAllocation(allocation)

    if (!metric) {
      return response.notFound({
        code: 'NO_TELEMETRY',
        message: 'Não há dados de telemetria para este período.',
      })
    }

    await notifySessionSummaryReady(allocation, allocation.machine)

    return response.created(serializeAllocationMetric(metric))
  }

  /**
   * Retorna o resumo/métricas de uma sessão.
   * - User normal: só pode ver suas próprias alocações
   * - Admin: pode ver todas
   *
   * GET /api/v1/allocations/:id/summary
   */
  async getSessionSummary({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)

    // User normal só pode ver suas próprias alocações
    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({
        code: 'NOT_OWNER',
        message: 'Você só pode visualizar o resumo das suas próprias alocações.',
      })
    }

    await allocation.load('metric')

    if (!allocation.metric) {
      return response.notFound({
        code: 'NO_SUMMARY',
        message: 'Esta alocação ainda não possui um resumo.',
      })
    }

    return response.ok(serializeAllocationMetric(allocation.metric))
  }
}
