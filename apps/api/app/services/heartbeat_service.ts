import { DateTime } from 'luxon'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import MachineUser from '#models/machine_user'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import logger from '@adonisjs/core/services/logger'
import { buildAgentTelemetryConfig } from '#services/telemetry_presets'
import {
  checkSshFailureFlood,
  maybeNotifyMissingSshKeyAtSessionStart,
} from '#services/notification_service'
import {
  graceEndsAt,
  machineHasAllocationTelemetry,
  phaseToProvisioning,
  resolveDominantAccessForUser,
  sftpEndsAt,
  type AccessPhase,
} from '#services/allocation_access'
import { getLabAccessConfig } from '#services/lab_config'

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

    const provisioning: any[] = []
    let currentAllocationPayload: Allocation | null = null
    let currentPhase: AccessPhase = 'none'

    for (const { phase, allocation } of phasesByUserId.values()) {
      const user = allocation.user
      if (!user?.systemUsername) {
        continue
      }

      const prov = phaseToProvisioning(phase, allocation, user.sshPublicKey)
      if (!prov) {
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
          lastActiveAt: prov.accessState === 'full_shell' ? now : undefined,
        }
      )

      provisioning.push({
        systemUsername: user.systemUsername,
        sshPublicKey: prov.sshPublicKey,
        accessState: prov.accessState,
        revokeSshKey: prov.revokeSshKey,
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
