import { DateTime } from 'luxon'
import type Allocation from '#models/allocation'
import { getLabAccessConfig } from '#services/lab_config'

export type AccessPhase =
  | 'none'
  | 'prepare'
  | 'active'
  | 'grace'
  | 'post_sftp'
  | 'no_key'
  | 'teardown'

export type LabAccessConfig = ReturnType<typeof getLabAccessConfig>

const PROVISIONING_STATUSES = ['approved', 'finished'] as const

/** Fim do bash com grace. `finished` (finalização antecipada) não recebe grace — só `endTime`. */
export function graceEndsAt(allocation: Allocation, access: LabAccessConfig = getLabAccessConfig()) {
  if (allocation.status === 'finished') {
    return allocation.endTime
  }
  return allocation.endTime.plus({ minutes: access.graceMinutes })
}

/** Fim do SFTP com chave. `finished` (incl. finish manual): sem janela SFTP — pula direto para `no_key`. */
export function sftpEndsAt(allocation: Allocation, access: LabAccessConfig = getLabAccessConfig()) {
  if (allocation.status === 'finished') {
    return allocation.endTime
  }
  return allocation.endTime.plus({
    minutes: access.graceMinutes + access.postSftpMinutes,
  })
}

export function deleteUserAt(
  allocation: Allocation,
  access: LabAccessConfig = getLabAccessConfig()
) {
  return allocation.endTime.plus({ days: access.deleteUserDays })
}

/** Alocação ainda exige linha em machine_users / provisioning no agente. */
export function allocationNeedsProvisioning(
  allocation: Allocation,
  now: DateTime = DateTime.utc()
): boolean {
  if (!PROVISIONING_STATUSES.includes(allocation.status as (typeof PROVISIONING_STATUSES)[number])) {
    return false
  }
  const phase = resolveAccessPhase(allocation, now)
  return phase !== 'none' && phase !== 'teardown'
}

export function resolveAccessPhase(
  allocation: Allocation,
  now: DateTime = DateTime.utc(),
  access: LabAccessConfig = getLabAccessConfig()
): AccessPhase {
  if (!['approved', 'finished'].includes(allocation.status)) {
    return 'none'
  }

  const nowMs = now.toMillis()
  const startMs = allocation.startTime.toMillis()
  const endMs = allocation.endTime.toMillis()
  const graceEndMs = graceEndsAt(allocation, access).toMillis()
  const sftpEndMs = sftpEndsAt(allocation, access).toMillis()
  const deleteMs = deleteUserAt(allocation, access).toMillis()

  if (nowMs >= deleteMs) {
    return 'teardown'
  }
  if (nowMs >= sftpEndMs) {
    return 'no_key'
  }
  if (nowMs >= graceEndMs) {
    return 'post_sftp'
  }
  if (allocation.status === 'approved' && nowMs >= endMs && nowMs < graceEndMs) {
    return 'grace'
  }
  if (nowMs >= startMs && nowMs < endMs) {
    return 'active'
  }
  if (
    allocation.status === 'approved' &&
    nowMs < startMs &&
    allocation.startTime.diff(now, 'minutes').minutes <= access.prepareMinutes
  ) {
    return 'prepare'
  }
  return 'none'
}

export type ProvisioningAccess = {
  accessState: 'full_shell' | 'sftp_only'
  sshPublicKey: string
  revokeSshKey: boolean
}

/** Ordem de permissividade: sessão ativa sempre vence pós-reserva do mesmo usuário. */
const PHASE_RANK: Record<AccessPhase, number> = {
  none: 0,
  teardown: 0,
  no_key: 10,
  post_sftp: 20,
  prepare: 30,
  grace: 40,
  active: 50,
}

export function phaseToProvisioning(
  phase: AccessPhase,
  allocation: Allocation,
  userSshKey: string | null
): ProvisioningAccess | null {
  switch (phase) {
    case 'prepare':
    case 'post_sftp':
      return {
        accessState: 'sftp_only',
        sshPublicKey: userSshKey || '',
        revokeSshKey: false,
      }
    case 'active':
    case 'grace':
      return {
        accessState: 'full_shell',
        sshPublicKey: userSshKey || '',
        revokeSshKey: false,
      }
    case 'no_key':
      return {
        accessState: 'sftp_only',
        sshPublicKey: '',
        revokeSshKey: true,
      }
    default:
      return null
  }
}

/**
 * Entre várias alocações do mesmo usuário na mesma máquina, escolhe a fase dominante
 * (ex.: reserva nova `active` prevalece sobre pós-SFTP de reserva anterior).
 */
export function resolveDominantAccessForUser(
  allocations: Allocation[],
  now: DateTime = DateTime.utc(),
  access: LabAccessConfig = getLabAccessConfig()
): { phase: AccessPhase; allocation: Allocation } | null {
  let best: { phase: AccessPhase; allocation: Allocation } | null = null

  for (const allocation of allocations) {
    if (!allocationNeedsProvisioning(allocation, now)) {
      continue
    }
    const phase = resolveAccessPhase(allocation, now, access)
    if (phase === 'none' || phase === 'teardown') {
      continue
    }
    if (!best || PHASE_RANK[phase] > PHASE_RANK[best.phase]) {
      best = { phase, allocation }
    }
  }

  return best
}

export function isTelemetryHotPhase(phase: AccessPhase): boolean {
  return phase === 'active' || phase === 'grace'
}

/** Máquina com alocação em curso (prepare → pós-SFTP), exceto teardown. */
export function machineHasAllocationTelemetry(phase: AccessPhase): boolean {
  return phase !== 'none' && phase !== 'teardown'
}
