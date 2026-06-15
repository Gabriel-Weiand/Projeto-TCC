import { DateTime } from 'luxon'
import Machine from '#models/machine'
import User from '#models/user'
import Allocation from '#models/allocation'
import MachineUser from '#models/machine_user'
import {
  resolveDominantAccessForUser,
  type AccessPhase,
} from '#services/allocation/access'
import { getLabAccessConfig } from '#services/lab/config'

export type AccessType = 'auto' | 'shell' | 'sftp' | 'revoked'

export type ProvisioningOrder = {
  systemUsername: string
  sshPublicKey: string
  accessState: 'full_shell' | 'sftp_only'
  revokeSshKey: boolean
}

/** Provisioning fixo quando access_type !== auto (ignora ciclo de alocação). */
export function buildProvisioningFromAccessType(
  accessType: Exclude<AccessType, 'auto'>,
  systemUsername: string,
  sshPublicKey: string | null
): ProvisioningOrder {
  if (accessType === 'shell') {
    return {
      systemUsername,
      sshPublicKey: sshPublicKey || '',
      accessState: 'full_shell',
      revokeSshKey: false,
    }
  }
  if (accessType === 'sftp') {
    return {
      systemUsername,
      sshPublicKey: sshPublicKey || '',
      accessState: 'sftp_only',
      revokeSshKey: false,
    }
  }
  return {
    systemUsername,
    sshPublicKey: sshPublicKey || '',
    accessState: 'sftp_only',
    revokeSshKey: true,
  }
}

function isBlockingPhase(phase: AccessPhase): boolean {
  return phase !== 'none' && phase !== 'teardown' && phase !== 'no_key'
}

async function userHasBlockingAllocation(machineId: number, userId: number): Promise<boolean> {
  const now = DateTime.utc()
  const access = getLabAccessConfig()
  const allocations = await Allocation.query()
    .where('machineId', machineId)
    .where('userId', userId)
    .whereIn('status', ['approved', 'finished'])
    .preload('user')

  const dominant = resolveDominantAccessForUser(allocations, now, access)
  return dominant ? isBlockingPhase(dominant.phase) : false
}

export async function createMachineUser(
  machineId: number,
  userId: number,
  accessType: Exclude<AccessType, 'auto'> = 'shell'
) {
  await Machine.findOrFail(machineId)
  const user = await User.findOrFail(userId)

  if (!user.systemUsername?.trim()) {
    throw new Error('USER_WITHOUT_SYSTEM_USERNAME')
  }

  const existing = await MachineUser.query()
    .where('machineId', machineId)
    .where('userId', userId)
    .first()

  if (existing) {
    throw new Error('ALREADY_PROVISIONED')
  }

  await MachineUser.create({
    machineId,
    userId,
    osUsername: user.systemUsername,
    accessType,
  })

  return listMachineProvisionedUsers(machineId)
}

export async function listMachineProvisionedUsers(machineId: number) {
  await Machine.findOrFail(machineId)
  const rows = await MachineUser.query().where('machineId', machineId).preload('user')

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    osUsername: row.osUsername,
    fullName: row.user!.fullName,
    accessType: (row.accessType as AccessType) ?? 'auto',
    lastActiveAt: row.lastActiveAt?.toISO() ?? null,
  }))
}

export async function updateMachineUserAccessType(
  machineId: number,
  userId: number,
  accessType: AccessType
) {
  await Machine.findOrFail(machineId)
  const row = await MachineUser.query()
    .where('machineId', machineId)
    .where('userId', userId)
    .firstOrFail()

  row.accessType = accessType
  await row.save()
  return listMachineProvisionedUsers(machineId)
}

export async function deleteMachineUser(machineId: number, userId: number) {
  await Machine.findOrFail(machineId)

  if (await userHasBlockingAllocation(machineId, userId)) {
    throw new Error('ACTIVE_ALLOCATION')
  }

  const row = await MachineUser.query()
    .where('machineId', machineId)
    .where('userId', userId)
    .firstOrFail()

  await row.delete()
}
