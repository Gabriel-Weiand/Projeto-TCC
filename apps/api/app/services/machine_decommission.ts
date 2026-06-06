import Machine from '#models/machine'
import MachineUser from '#models/machine_user'
import { cancelAllocationsForMaintenance } from '#services/notification_service'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { idleTelemetryBuffer } from '#services/telemetry_idle_buffer'
import { machineCache } from '#services/machine_cache'

type MachineCustomConfig = Record<string, unknown> & { pendingRemoval?: boolean }

export function isMachinePendingRemoval(machine: Machine): boolean {
  const config = machine.customAgentConfig as MachineCustomConfig | null
  return Boolean(config?.pendingRemoval)
}

/**
 * Primeira fase da exclusão admin: cancela reservas, limpa inventário machine_users
 * e marca pendingRemoval para o agente remover contas lab.* em todas as partições.
 */
export async function prepareMachineDecommission(machine: Machine): Promise<number> {
  const cancelledCount = await cancelAllocationsForMaintenance(machine)

  await MachineUser.query().where('machineId', machine.id).delete()

  const config = (machine.customAgentConfig ?? {}) as MachineCustomConfig
  machine.customAgentConfig = { ...config, pendingRemoval: true }
  machine.status = 'offline'
  await machine.save()

  return cancelledCount
}

/** Segunda fase: remove registro da máquina e buffers de telemetria. */
export async function finalizeMachineDeletion(machine: Machine): Promise<void> {
  machineCache.invalidateById(machine.id)
  machineCache.invalidate(machine.token)
  telemetryBuffer.clearMachine(machine.id)
  idleTelemetryBuffer.clearMachine(machine.id)
  await machine.delete()
}
