import { DateTime } from 'luxon'
import type Machine from '#models/machine'
import Allocation from '#models/allocation'
import { graceEndsAt, type LabAccessConfig } from '#services/allocation/access'
import { getLabAccessConfig } from '#services/lab/config'
import { dateTimeFromSqlUtc } from '#utils/datetime'

export type MachineOperationalMode = 'available' | 'offline' | 'maintenance'
export type MachineEffectiveStatus = 'available' | 'occupied' | 'maintenance' | 'offline' | 'disabled'

/** Sem heartbeat neste intervalo → offline efetivo (modo automático). */
export const MACHINE_HEARTBEAT_OFFLINE_HOURS = 24

/** Status persistido que o admin pode escolher no painel. */
export function normalizeOperationalMode(
  storedStatus: string | null | undefined
): MachineOperationalMode {
  if (storedStatus === 'maintenance') return 'maintenance'
  if (storedStatus === 'offline') return 'offline'
  return 'available'
}

export function allocationCountsAsOccupied(
  allocation: Allocation,
  now: DateTime = DateTime.utc(),
  access: LabAccessConfig = getLabAccessConfig()
): boolean {
  if (!['approved', 'finished'].includes(allocation.status)) return false

  const nowMs = now.toMillis()
  const startMs = allocation.startTime.toMillis()
  const occupiedUntilMs = graceEndsAt(allocation, access).toMillis()

  return nowMs >= startMs && nowMs < occupiedUntilMs
}

function lastSeenUtcMs(lastSeenAt: Machine['lastSeenAt']): number | null {
  if (!lastSeenAt) return null
  if (DateTime.isDateTime(lastSeenAt)) {
    return lastSeenAt.isValid ? lastSeenAt.toUTC().toMillis() : null
  }
  if (typeof lastSeenAt === 'string') {
    const parsed = dateTimeFromSqlUtc(lastSeenAt)
    return parsed.isValid ? parsed.toMillis() : null
  }
  return null
}

export function isHeartbeatStale(
  machine: Machine,
  now: DateTime = DateTime.utc(),
  offlineHours = MACHINE_HEARTBEAT_OFFLINE_HOURS
): boolean {
  const lastMs = lastSeenUtcMs(machine.lastSeenAt)
  if (lastMs === null) return true
  const cutoffMs = now.minus({ hours: offlineHours }).toUTC().toMillis()
  return lastMs < cutoffMs
}

export function resolveEffectiveMachineStatus(
  machine: Machine,
  occupiedMachineIds: Set<number>,
  now: DateTime = DateTime.utc(),
  offlineHours = MACHINE_HEARTBEAT_OFFLINE_HOURS
): MachineEffectiveStatus {
  const mode = normalizeOperationalMode(machine.status)

  if (mode === 'maintenance') return 'maintenance'
  if (mode === 'offline') return 'disabled'

  if (isHeartbeatStale(machine, now, offlineHours)) return 'offline'
  if (occupiedMachineIds.has(machine.id)) return 'occupied'
  return 'available'
}

export async function buildOccupiedMachineIds(
  now: DateTime = DateTime.utc(),
  access: LabAccessConfig = getLabAccessConfig()
): Promise<Set<number>> {
  const allocations = await Allocation.query()
    .whereIn('status', ['approved', 'finished'])
    .select('id', 'machineId', 'startTime', 'endTime', 'status')

  const occupied = new Set<number>()
  for (const allocation of allocations) {
    if (allocationCountsAsOccupied(allocation, now, access)) {
      occupied.add(allocation.machineId)
    }
  }
  return occupied
}
