import { DateTime } from 'luxon'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import MachineUser from '#models/machine_user'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import logger from '@adonisjs/core/services/logger'
import { buildAgentTelemetryConfig } from '#services/telemetry/presets'
import {
  checkSshFailureFlood,
  maybeNotifyMissingSshKeyAtSessionStart,
} from '#services/notification/notification_service'
import {
  graceEndsAt,
  machineHasAllocationTelemetry,
  phaseToProvisioning,
  resolveDominantAccessForUser,
  allowHomeMigrationForUser,
  sftpEndsAt,
  type AccessPhase,
} from '#services/allocation/access'
import {
  buildProvisioningFromAccessType,
  type AccessType,
} from '#services/machine/provisioned_users'
import { getLabAccessConfig } from '#services/lab/config'
import { resolveHomeDirectory } from '#services/machine/disk_partitions'

export default class HeartbeatService {
  /**
   * Processa o ciclo de Heartbeat do agente, executando Reconciliação (Drift)
   * e retornando as ordens de provisionamento.
   */
  public async processHeartbeat(
    machine: Machine,
    payload: {
      connectedUsers?: string[]
      provisionedOsUsers?: string[]
      sshAttempts?: any[]
    }
  ) {
    const now = DateTime.utc()
    const access = getLabAccessConfig()

    if (machine.customAgentConfig && (machine.customAgentConfig as Record<string, unknown>).pendingRemoval) {
      const telemetry = buildAgentTelemetryConfig(machine, false)
      return {
        status: 'acknowledged',
        decommission: true,
        agentConfig: { telemetry },
        provisioning: [],
        accessControl: { shouldBlock: false },
        currentAllocation: null,
      }
    }

    if (payload.sshAttempts && payload.sshAttempts.length > 0) {
      try {
        await SshConnectionAttempt.createMany(
          payload.sshAttempts.map((attempt) => ({
            machineId: machine.id,
            ...attempt,
          }))
        )
        await checkSshFailureFlood(machine)
      } catch (error) {
        logger.error(`[Heartbeat] Falha ao gravar auditoria SSH da máquina ${machine.id}`, error)
      }
    }

    const lifecycleAllocations = await Allocation.query()
      .where('machineId', machine.id)
      .whereIn('status', ['approved', 'finished'])
      .preload('user')

    const allocationsByUserId = new Map<number, Allocation[]>()
    for (const allocation of lifecycleAllocations) {
      if (!allocation.user) {
        continue
      }
      const list = allocationsByUserId.get(allocation.userId) ?? []
      list.push(allocation)
      allocationsByUserId.set(allocation.userId, list)
    }

    const phasesByUserId = new Map<number, { phase: AccessPhase; allocation: Allocation }>()
    for (const [userId, userAllocations] of allocationsByUserId) {
      const dominant = resolveDominantAccessForUser(userAllocations, now, access)
      if (dominant) {
        phasesByUserId.set(userId, dominant)
      }
    }

    const dbMachineUsers = await MachineUser.query().where('machineId', machine.id).preload('user')
    const osUsers = payload.provisionedOsUsers || []

    for (const dbUser of dbMachineUsers) {
      if (!osUsers.includes(dbUser.osUsername)) {
        const needed = phasesByUserId.has(dbUser.userId)
        if (!needed) {
          await dbUser.delete()
          logger.info(
            `[Drift] Usuário ${dbUser.osUsername} removido do inventário da máquina ${machine.id}`
          )
        }
      }
    }

    const fixedAccessByUserId = new Map(
      dbMachineUsers
        .filter((row) => (row.accessType as AccessType) !== 'auto')
        .map((row) => [row.userId, row.accessType as AccessType] as const)
    )

    const provisioning: any[] = []
    let currentAllocationPayload: Allocation | null = null
    let currentPhase: AccessPhase = 'none'

    // access_type fixo: ignora fases de alocação para este usuário
    for (const dbUser of dbMachineUsers) {
      const accessType = (dbUser.accessType as AccessType) ?? 'auto'
      if (accessType === 'auto') continue

      const user = dbUser.user
      if (!user?.systemUsername) continue

      const prov = buildProvisioningFromAccessType(
        accessType,
        user.systemUsername,
        user.sshPublicKey
      )

      provisioning.push({
        systemUsername: prov.systemUsername,
        sshPublicKey: prov.sshPublicKey,
        accessState: prov.accessState,
        revokeSshKey: prov.revokeSshKey,
      })

      await MachineUser.updateOrCreate(
        { machineId: machine.id, userId: user.id },
        {
          osUsername: user.systemUsername,
          lastActiveAt: prov.accessState === 'full_shell' ? now : undefined,
        }
      )
    }

    // auto: segue ciclo de vida da alocação (exceto usuários com access_type fixo)
    for (const { phase, allocation } of phasesByUserId.values()) {
      const user = allocation.user
      if (!user?.systemUsername) {
        continue
      }

      if (fixedAccessByUserId.has(user.id)) {
        continue
      }

      const allocationProv = phaseToProvisioning(phase, allocation, user.sshPublicKey)
      if (!allocationProv) {
        continue
      }

      if (phase === 'active' || phase === 'grace') {
        currentAllocationPayload = allocation
        currentPhase = phase
        if (phase === 'active') {
          await maybeNotifyMissingSshKeyAtSessionStart(allocation, machine)
        }
      }

      await MachineUser.updateOrCreate(
        { machineId: machine.id, userId: user.id },
        {
          osUsername: user.systemUsername,
          lastActiveAt: allocationProv.accessState === 'full_shell' ? now : undefined,
        }
      )

      const homeDirectory = resolveHomeDirectory(
        user.systemUsername,
        allocation.homeMountpoint
      )

      const userAllocations = allocationsByUserId.get(user.id) ?? []
      const allowHomeMigration = allowHomeMigrationForUser(
        userAllocations,
        allocation,
        homeDirectory,
        now,
        access
      )

      provisioning.push({
        systemUsername: user.systemUsername,
        sshPublicKey: allocationProv.sshPublicKey,
        accessState: allocationProv.accessState,
        revokeSshKey: allocationProv.revokeSshKey,
        ...(homeDirectory ? { homeDirectory } : {}),
        ...(allowHomeMigration ? { allowHomeMigration: true } : {}),
      })
    }

    let isInAllocation = false
    for (const { phase } of phasesByUserId.values()) {
      if (machineHasAllocationTelemetry(phase)) {
        isInAllocation = true
        break
      }
    }
    const telemetry = buildAgentTelemetryConfig(machine, isInAllocation)

    const current = currentAllocationPayload
    return {
      status: 'acknowledged',
      agentConfig: {
        telemetry,
      },
      provisioning,
      accessControl: {
        shouldBlock: false,
      },
      currentAllocation: current
        ? {
            id: current.id,
            userId: current.userId,
            userName: current.user?.fullName,
            endTime: current.endTime.toISO(),
            phase: currentPhase,
            graceEndsAt: graceEndsAt(current, access).toISO(),
            sftpEndsAt: sftpEndsAt(current, access).toISO(),
          }
        : null,
    }
  }
}
