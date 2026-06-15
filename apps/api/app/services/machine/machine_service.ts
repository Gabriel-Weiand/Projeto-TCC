import Machine from '#models/machine'
import Allocation from '#models/allocation'
import { machineCache } from '#services/machine/cache'
import { cancelAllocationsForMaintenance } from '#services/notification/notification_service'
import { normalizeCustomAgentConfig } from '#services/telemetry/presets'
import { telemetryBuffer } from '#services/telemetry/buffer'
import {
  buildOccupiedMachineIds,
  normalizeOperationalMode,
} from '#services/machine/effective_status'
import {
  finalizeMachineDeletion,
  isMachinePendingRemoval,
  prepareMachineDecommission,
} from '#services/machine/decommission'
import { normalizeAdminMachineWireFields } from '#services/machine/specs_merge'
import {
  mergeAdminDiskPolicyUpdate,
  validateMachineDiskPolicy,
} from '#services/machine/disk_partitions'
import {
  createMachineUser,
  deleteMachineUser,
  listMachineProvisionedUsers,
  updateMachineUserAccessType,
  type AccessType,
} from '#services/machine/provisioned_users'
import { DomainError } from '#services/shared/domain_error'
import {
  buildIdleHistory,
  normalizeTelemetryStreamBatch,
  resolveParkTelemetry,
  serializeMachineForApi,
} from '#services/machine/api_format'
import { normalizeRealtimeTelemetry } from '#services/telemetry/normalize'
import type { Infer } from '@vinejs/vine/types'
import type {
  createMachineValidator,
  updateMachineValidator,
} from '#validators/machine'

type CreateMachinePayload = Infer<typeof createMachineValidator>
type UpdateMachinePayload = Infer<typeof updateMachineValidator>

function mapProvisionedUserError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message === 'USER_WITHOUT_SYSTEM_USERNAME') {
      throw new DomainError(
        'USER_WITHOUT_SYSTEM_USERNAME',
        'O usuário não possui system_username cadastrado.',
        400
      )
    }
    if (error.message === 'ALREADY_PROVISIONED') {
      throw new DomainError(
        'ALREADY_PROVISIONED',
        'Este usuário já está vinculado a esta máquina.',
        409
      )
    }
    if (error.message === 'ACTIVE_ALLOCATION') {
      throw new DomainError(
        'ACTIVE_ALLOCATION',
        'Não é possível remover usuário com alocação ativa nesta máquina. Finalize ou cancele a reserva primeiro.',
        409
      )
    }
  }
  throw error
}

export const MachineService = {
  async listMachines() {
    const machines = await Machine.query().preload('group').orderBy('name', 'asc')
    const occupiedMachineIds = await buildOccupiedMachineIds()

    return machines.map((machine) =>
      serializeMachineForApi(
        machine,
        resolveParkTelemetry(machine.id),
        occupiedMachineIds
      )
    )
  },

  async createMachine(data: CreateMachinePayload) {
    const wireData = { ...data } as Record<string, unknown>
    normalizeAdminMachineWireFields(wireData)

    const machine = await Machine.create(wireData)
    const occupiedMachineIds = await buildOccupiedMachineIds()

    return {
      ...serializeMachineForApi(machine, null, occupiedMachineIds),
      token: machine.token,
    }
  },

  async getMachine(machineId: number) {
    const machine = await Machine.findOrFail(machineId)
    await machine.load('group')
    const occupiedMachineIds = await buildOccupiedMachineIds()

    return serializeMachineForApi(
      machine,
      resolveParkTelemetry(machine.id),
      occupiedMachineIds
    )
  },

  async updateMachine(machineId: number, data: UpdateMachinePayload) {
    const machine = await Machine.findOrFail(machineId)
    const wireData = { ...data } as Record<string, unknown>
    normalizeAdminMachineWireFields(wireData)

    const wasNotInMaintenance = machine.status !== 'maintenance'
    const isEnteringMaintenance = wireData.status === 'maintenance'

    const updateData = wireData as Record<string, unknown>
    if (updateData.status !== undefined) {
      updateData.status = normalizeOperationalMode(updateData.status as string)
    }
    if (updateData.customAgentConfig !== undefined) {
      updateData.customAgentConfig = normalizeCustomAgentConfig(updateData.customAgentConfig)
    }
    if (updateData.disks !== undefined) {
      updateData.disks = mergeAdminDiskPolicyUpdate(updateData.disks, machine.disks)
    }

    const onlyMainDisk =
      updateData.onlyMainDisk !== undefined
        ? Boolean(updateData.onlyMainDisk)
        : machine.onlyMainDisk

    if (updateData.disks !== undefined) {
      const policyError = validateMachineDiskPolicy(updateData.disks, onlyMainDisk)
      if (policyError) {
        throw new DomainError('INVALID_DISK_POLICY', policyError, 422)
      }
    }

    machine.merge(updateData)
    await machine.save()

    let cancelledCount = 0
    if (wasNotInMaintenance && isEnteringMaintenance) {
      cancelledCount = await cancelAllocationsForMaintenance(machine)
    }

    machineCache.invalidateById(machine.id)

    const occupiedMachineIds = await buildOccupiedMachineIds()
    const presented = serializeMachineForApi(
      machine,
      resolveParkTelemetry(machine.id),
      occupiedMachineIds
    )

    return {
      ...presented,
      cancelledAllocations: cancelledCount > 0 ? cancelledCount : undefined,
    }
  },

  async deleteMachine(machineId: number) {
    const machine = await Machine.findOrFail(machineId)

    if (!isMachinePendingRemoval(machine)) {
      const cancelledCount = await prepareMachineDecommission(machine)
      machineCache.invalidateById(machine.id)
      machineCache.invalidate(machine.token)

      return {
        decommissioning: true as const,
        status: 'decommissioning' as const,
        message:
          'Máquina marcada para descomissionamento. O agente removerá usuários lab.* na próxima sincronização (~30s). Repita a exclusão para remover o registro.',
        cancelledAllocations: cancelledCount > 0 ? cancelledCount : undefined,
      }
    }

    await finalizeMachineDeletion(machine)
    return { decommissioning: false as const }
  },

  async getMachineTelemetry(machineId: number, page: number, limit: number) {
    const machine = await Machine.findOrFail(machineId)
    const allocations = await Allocation.query().where('machineId', machine.id).select('id')
    const allocationIds = allocations.map((a) => a.id)
    const idleHistory = buildIdleHistory(machine.id)

    if (allocationIds.length === 0) {
      return {
        realtime: normalizeRealtimeTelemetry(telemetryBuffer.getLatest(machine.id)),
        idleHistory,
        history: { data: [], meta: { total: 0, perPage: limit, currentPage: page } },
      }
    }

    const Telemetry = (await import('#models/telemetry')).default
    const telemetries = await Telemetry.query()
      .whereIn('allocationId', allocationIds)
      .orderBy('id', 'desc')
      .paginate(page, limit)

    return {
      realtime: normalizeRealtimeTelemetry(telemetryBuffer.getLatest(machine.id)),
      idleHistory,
      history: telemetries,
    }
  },

  async regenerateToken(machineId: number) {
    const machine = await Machine.findOrFail(machineId)

    machineCache.invalidate(machine.token)
    const newToken = machine.regenerateToken()
    await machine.save()

    return {
      message: 'Token regenerado com sucesso. Configure o agente com o novo token.',
      machineId: machine.id,
      machineName: machine.name,
      token: newToken,
      tokenRotatedAt: machine.tokenRotatedAt,
    }
  },

  async getTelemetryStream(machineId: number, count?: number) {
    const machine = await Machine.findOrFail(machineId)
    const maxCount = count ? Math.min(count, 15) : 15
    const batch = telemetryBuffer.getLastBatch(machine.id, maxCount)
    const normalized = normalizeTelemetryStreamBatch(batch)
    const latest = normalizeRealtimeTelemetry(telemetryBuffer.getLatest(machine.id))

    return {
      machineId: machine.id,
      batch: normalized,
      entries: normalized,
      latest,
      total: normalized.length,
    }
  },

  async listProvisionedUsers(machineId: number) {
    return listMachineProvisionedUsers(machineId)
  },

  async createProvisionedUser(
    machineId: number,
    userId: number,
    accessType: Exclude<AccessType, 'auto'>
  ) {
    try {
      return await createMachineUser(machineId, userId, accessType)
    } catch (error) {
      mapProvisionedUserError(error)
    }
  },

  async updateProvisionedUser(machineId: number, userId: number, accessType: AccessType) {
    return updateMachineUserAccessType(machineId, userId, accessType)
  },

  async deleteProvisionedUser(machineId: number, userId: number) {
    try {
      await deleteMachineUser(machineId, userId)
    } catch (error) {
      mapProvisionedUserError(error)
    }
  },
}
