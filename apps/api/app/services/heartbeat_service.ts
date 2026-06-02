import { DateTime } from 'luxon'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import MachineUser from '#models/machine_user'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import logger from '@adonisjs/core/services/logger'
import { buildAgentTelemetryConfig } from '#services/telemetry_presets'

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

    // ==========================================
    // 1. AUDITORIA: Salvar tentativas de SSH
    // ==========================================
    if (payload.sshAttempts && payload.sshAttempts.length > 0) {
      try {
        await SshConnectionAttempt.createMany(
          payload.sshAttempts.map((attempt) => ({
            machineId: machine.id,
            ...attempt,
          }))
        )
      } catch (error) {
        logger.error(`[Heartbeat] Falha ao gravar auditoria SSH da máquina ${machine.id}`, error)
      }
    }

    // ==========================================
    // 2. ESTADO DAS ALOCAÇÕES (Ativa e T-5 Pendente)
    // ==========================================
    const activeAllocations = await Allocation.query()
      .where('machineId', machine.id)
      .whereIn('status', ['approved'])
      .preload('user')

    // Alocação rodando neste exato segundo
    const currentAllocation = activeAllocations.find(
      (a) => a.startTime.toMillis() <= now.toMillis() && a.endTime.toMillis() >= now.toMillis()
    )

    // Alocação que vai começar em 5 minutos ou menos (T-5 Provisionamento Antecipado)
    const pendingAllocation = activeAllocations.find(
      (a) =>
        a.startTime.toMillis() > now.toMillis() && a.startTime.diff(now, 'minutes').minutes <= 5
    )

    // ==========================================
    // 3. RECONCILIAÇÃO (Drift Detection)
    // ==========================================
    const dbMachineUsers = await MachineUser.query().where('machineId', machine.id).preload('user')

    const osUsers = payload.provisionedOsUsers || []

    for (const dbUser of dbMachineUsers) {
      if (!osUsers.includes(dbUser.osUsername)) {
        // DESVIO: O usuário existe no banco, mas sumiu do Linux (Admin excluiu na mão?)
        const isNeededNow =
          currentAllocation?.userId === dbUser.userId || pendingAllocation?.userId === dbUser.userId

        if (!isNeededNow) {
          // Se não precisa dele agora, deletamos do banco para refletir a realidade do SO
          await dbUser.delete()
          logger.info(
            `[Drift] Usuário ${dbUser.osUsername} removido do inventário da máquina ${machine.id}`
          )
        }
        // Se ele for necessário, ele será recriado no passo 4 abaixo.
      }
    }

    // ==========================================
    // 4. POLÍTICAS DE ACESSO E PROVISIONAMENTO
    // ==========================================
    const provisioning: any[] = []
    const usersToEnforce = new Map<number, any>()

    // Recarrega o banco após a limpeza do Drift
    const currentDbMachineUsers = await MachineUser.query()
      .where('machineId', machine.id)
      .preload('user')

    // REGRA A: Todos que já têm conta na máquina ficam restritos a SFTP (sem terminal)
    for (const dbUser of currentDbMachineUsers) {
      usersToEnforce.set(dbUser.userId, {
        user: dbUser.user,
        accessState: 'sftp_only',
        isSudo: false,
      })
    }

    // REGRA B: Preparação T-5 minutos (Cria a conta, mas deixa bloqueada no SFTP)
    if (pendingAllocation && pendingAllocation.user) {
      usersToEnforce.set(pendingAllocation.userId, {
        user: pendingAllocation.user,
        accessState: 'sftp_only',
        isSudo: false,
      })
    }

    // REGRA C: Alocação Ativa (Libera o Terminal e o Sudo se autorizado)
    if (currentAllocation && currentAllocation.user) {
      usersToEnforce.set(currentAllocation.userId, {
        user: currentAllocation.user,
        accessState: 'full_shell',
        isSudo: Boolean(currentAllocation.isSudo), // <-- Garante que vira true/false
      })
    }

    // Montar o payload final e garantir a tabela pivô (`machine_users`) atualizada
    for (const config of usersToEnforce.values()) {
      const user = config.user

      if (user.systemUsername) {
        await MachineUser.updateOrCreate(
          { machineId: machine.id, userId: user.id },
          {
            osUsername: user.systemUsername,
            lastActiveAt: config.accessState === 'full_shell' ? now : undefined,
          }
        )

        provisioning.push({
          systemUsername: user.systemUsername,
          sshPublicKey: user.sshPublicKey || '',
          accessState: config.accessState,
          isSudo: config.isSudo,
        })
      }
    }

    // ==========================================
    // 5. RESPOSTA DA API (Dita o ritmo do Python)
    // ==========================================

    const isOccupied = !!currentAllocation
    const telemetry = buildAgentTelemetryConfig(machine, isOccupied)

    return {
      status: 'acknowledged',
      agentConfig: {
        telemetry,
      },
      provisioning,
      accessControl: {
        shouldBlock: false, // Controlado agora pelo accessState (shell) em vez de overlay
      },
      currentAllocation: currentAllocation
        ? {
            id: currentAllocation.id,
            userId: currentAllocation.userId,
            userName: currentAllocation.user?.fullName,
            endTime: currentAllocation.endTime.toISO(),
          }
        : null,
    }
  }
}
