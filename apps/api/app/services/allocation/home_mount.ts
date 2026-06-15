import { DateTime } from 'luxon'
import type Allocation from '#models/allocation'
import type Machine from '#models/machine'
import { normalizeAllocationHomeMount } from '#services/machine/disk_partitions'

export function canChangeAllocationHomeMount(
  allocation: Allocation,
  now: DateTime = DateTime.utc()
): boolean {
  if (allocation.status !== 'approved') return false
  return now.toMillis() < allocation.startTime.toMillis()
}

export function resolveAllocationHomeMountForCreate(
  machine: Machine,
  homeMountpoint: string | null | undefined
): { homeMountpoint: string | null; error: string | null } {
  const { mountpoint, error } = normalizeAllocationHomeMount(
    machine.disks,
    Boolean(machine.onlyMainDisk),
    homeMountpoint
  )
  return { homeMountpoint: mountpoint, error }
}
