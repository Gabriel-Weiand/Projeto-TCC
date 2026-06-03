import { DateTime } from 'luxon'
import type Allocation from '#models/allocation'
import { resolveAccessPhase } from '#services/allocation_access'

/** Status exibido (API/front); `status` no banco permanece pending/approved/… */
export type AllocationLifecycleStatus =
  | 'pending'
  | 'approved'
  | 'active'
  | 'grace'
  | 'sftp'
  | 'finished'
  | 'denied'
  | 'cancelled'

const LIFECYCLE_FILTER_VALUES = [
  'active',
  'grace',
  'sftp',
] as const satisfies readonly AllocationLifecycleStatus[]

export function isLifecycleFilter(
  value: string
): value is (typeof LIFECYCLE_FILTER_VALUES)[number] {
  return (LIFECYCLE_FILTER_VALUES as readonly string[]).includes(value)
}

export function resolveLifecycleStatus(
  allocation: Allocation,
  now: DateTime = DateTime.utc()
): AllocationLifecycleStatus {
  const dbStatus = allocation.status

  if (dbStatus === 'pending' || dbStatus === 'denied' || dbStatus === 'cancelled') {
    return dbStatus
  }
  if (dbStatus === 'finished') {
    return 'finished'
  }

  if (dbStatus === 'approved') {
    const phase = resolveAccessPhase(allocation, now)
    if (phase === 'active') return 'active'
    if (phase === 'grace') return 'grace'
    if (phase === 'post_sftp') return 'sftp'
    if (phase === 'no_key' || phase === 'teardown') return 'finished'
    return 'approved'
  }

  return 'finished'
}

export function serializeAllocation(allocation: Allocation, now: DateTime = DateTime.utc()) {
  const json = allocation.serialize() as Record<string, unknown>
  json.lifecycleStatus = resolveLifecycleStatus(allocation, now)
  return json
}

export function serializeAllocationPage(
  paginator: { serialize: () => { meta: unknown; data: unknown[] }; all: () => Allocation[] },
  now: DateTime = DateTime.utc()
) {
  const { meta } = paginator.serialize() as { meta: unknown; data: unknown[] }
  const rows = paginator.all()
  return {
    meta,
    data: rows.map((row) => serializeAllocation(row, now)),
  }
}
