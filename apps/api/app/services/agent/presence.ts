import { DateTime } from 'luxon'
import type Machine from '#models/machine'
import { machineCache } from '#services/machine/cache'
import { mergeDiskPartitionsFromTelemetry } from '#services/machine/disk_partitions'

export type UpdateMachinePresenceOptions = {
  connectedUsers?: string[]
  disksInfo?: unknown[]
}

/**
 * Atualiza presença do agente (lastSeenAt) e invalida cache.
 * Heartbeat também grava currentSessions; telemetria pode atualizar partições de disco.
 */
export async function updateMachinePresence(
  machine: Machine,
  options?: UpdateMachinePresenceOptions
) {
  machine.lastSeenAt = DateTime.now()

  if (options?.connectedUsers !== undefined) {
    machine.currentSessions = options.connectedUsers
  }

  if (options?.disksInfo && options.disksInfo.length > 0) {
    machine.disks = mergeDiskPartitionsFromTelemetry(options.disksInfo, machine.disks)
  }

  await machine.save()
  machineCache.invalidate(machine.token)
}
