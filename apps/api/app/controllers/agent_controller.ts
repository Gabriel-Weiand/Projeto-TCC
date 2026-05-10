import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import { telemetryReportValidator } from '#validators/telemetry'
import {
  heartbeatValidator,
  syncSpecsValidator,
  sshSetupReportValidator,
  sshTeardownReportValidator,
} from '#validators/agent'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { machineCache } from '#services/machine_cache'
import SshSession from '#models/ssh_session'

export default class AgentController {
  /**
   * Helper: Encontra alocação ativa no momento atual.
   * Usa comparação em JavaScript para evitar problemas com SQLite.
   */
  private async findCurrentAllocation(machineId: number, userId?: number) {
    const now = DateTime.now().toMillis()

    let query = Allocation.query()
      .where('machineId', machineId)
      .where('status', 'approved')
      .preload('user')

    if (userId) {
      query = query.where('userId', userId)
    }

    const allocations = await query

    return (
      allocations.find((a) => a.startTime.toMillis() <= now && a.endTime.toMillis() >= now) || null
    )
  }

  /**
   * Helper: Encontra a próxima alocação futura da máquina (a que vai começar primeiro).
   */
  private async findNextAllocation(machineId: number) {
    const now = DateTime.now().toMillis()

    const allocations = await Allocation.query()
      .where('machineId', machineId)
      .whereIn('status', ['approved', 'pending'])
      .orderBy('startTime', 'asc')

    return allocations.find((a) => a.startTime.toMillis() > now) || null
  }

  /**
   * Heartbeat - Rota principal de polling do agente.
   * Atualiza último contato e recebe lista de usuários conectados via SSH.
   * Retorna status da máquina, alocação ativa e instrução de bloqueio.
   *
   * POST /api/agent/heartbeat
   *
   * Body:
   *   - connectedUsers: string[] — nomes de sistema dos usuários atualmente conectados
   *                                 (obtidos pelo agente via `who -q` / /var/run/utmp)
   */
  async heartbeat({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now()

    // Recebe lista de usuários conectados via SSH (lida pelo agente via `who -q` / utmp)
    const { connectedUsers = [] } = await request.validateUsing(heartbeatValidator)

    // Atualiza último contato
    machine.lastSeenAt = now

    // Atualiza usuário logado e status com base em quem está conectado.
    // Detecta se algo mudou para só invalidar o cache quando necessário.
    let stateChanged = false
    if (machine.status !== 'maintenance') {
      const newLoggedUser = connectedUsers.length > 0 ? connectedUsers[0] : null
      const newStatus = connectedUsers.length > 0 ? 'occupied' : 'available'

      if (machine.loggedUser !== newLoggedUser || machine.status !== newStatus) {
        machine.loggedUser = newLoggedUser
        machine.status = newStatus
        stateChanged = true
      }
    }

    await machine.save()

    // Invalida cache apenas quando loggedUser ou status realmente mudaram
    if (stateChanged) {
      machineCache.invalidate(machine.token)
    }

    // Busca alocação atual na máquina
    const currentAllocation = await this.findCurrentAllocation(machine.id)

    // Busca próxima alocação da máquina
    const nextAllocation = await this.findNextAllocation(machine.id)

    // === Determina se deve bloquear ===
    let shouldBlock = false
    let blockReason: string | null = null

    if (machine.status === 'maintenance') {
      shouldBlock = true
      blockReason = 'MACHINE_MAINTENANCE'
    } else if (connectedUsers.length > 0 && !currentAllocation) {
      // Há usuários conectados mas não há alocação ativa → bloquear
      shouldBlock = true
      blockReason = 'NO_VALID_ALLOCATION'
    }

    return response.ok({
      machine: {
        id: machine.id,
        name: machine.name,
        status: machine.status,
      },
      connectedUsers,
      connectedCount: connectedUsers.length,
      // Alocação atual - COM info do usuário (só aparece se tem alocação)
      currentAllocation: currentAllocation
        ? {
            id: currentAllocation.id,
            userId: currentAllocation.userId,
            userName: currentAllocation.user?.fullName,
            userEmail: currentAllocation.user?.email,
            startTime: currentAllocation.startTime,
            endTime: currentAllocation.endTime,
            remainingMinutes: Math.floor(currentAllocation.endTime.diff(now, 'minutes').minutes),
          }
        : null,
      // Próxima alocação (sem nome do usuário)
      nextAllocation: nextAllocation
        ? {
            startTime: nextAllocation.startTime,
            endTime: nextAllocation.endTime,
            minutesUntilStart: Math.floor(
              nextAllocation.startTime.diff(now, 'minutes').minutes
            ),
          }
        : null,
      // Controle de bloqueio
      shouldBlock,
      blockReason,
      serverTime: now.toISO(),
    })
  }

  /**
   * Sincroniza especificações de hardware detectadas pelo agente.
   *
   * PUT /api/agent/sync-specs
   */
  async syncSpecs({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(syncSpecsValidator)

    machine.merge(data)
    await machine.save()

    // Invalida cache para refletir mudança
    machineCache.invalidate(machine.token)

    return response.ok({
      synced: true,
      machine: {
        id: machine.id,
        name: machine.name,
        cpuModel: machine.cpuModel,
        gpuModel: machine.gpuModel,
        totalRamGb: machine.totalRamGb,
        totalDiskGb: machine.totalDiskGb,
        ipAddress: machine.ipAddress,
      },
    })
  }

  /**
   * Recebe telemetria do agente.
   * Estado real-time é SEMPRE atualizado (para dashboard).
   * Persistência no banco ocorre apenas quando há alocação ativa.
   *
   * POST /api/agent/telemetry
   */
  async telemetry({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const { lean, rich } = await request.validateUsing(telemetryReportValidator)

    // Estado real-time usa os dados RICH (com cores, frequências, etc.)
    // para que o dashboard admin tenha máximo de informação
    const realtimeData = { allocationId: 0, ...rich }

    // Persiste no banco apenas se houver alocação ativa
    // Persiste apenas o LEAN (escalares compactos) — sem arrays de cores
    const currentAllocation = await this.findCurrentAllocation(machine.id)
    if (currentAllocation) {
      // add() já chama updateRealtime() internamente
      telemetryBuffer.add(machine.id, {
        allocationId: currentAllocation.id,
        ...lean,
      })
      // O estado real-time recebe o RICH para o dashboard
      telemetryBuffer.updateRealtime(machine.id, { allocationId: currentAllocation.id, ...rich })
    } else {
      // Sem alocação: atualiza apenas o estado real-time (sem persistir)
      telemetryBuffer.updateRealtime(machine.id, realtimeData)
    }

    // Atualiza último contato
    machine.lastSeenAt = DateTime.now()
    if (machine.status === 'offline') {
      machine.status = 'available'
    }
    await machine.save()

    return response.noContent()
  }

  // ============================================================
  // SSH Session Management (Server Agent)
  // ============================================================

  /**
   * Retorna pedidos de SSH pendentes para esta máquina.
   * O agente servidor faz polling nesta rota para saber quando precisa gerar chaves.
   *
   * GET /api/agent/ssh/pending
   */
  async sshPendingRequests({ authenticatedMachine, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now().toMillis()

    // Busca alocações ativas que ainda não têm sessão SSH
    const activeAllocations = await Allocation.query()
      .where('machineId', machine.id)
      .where('status', 'approved')
      .preload('user')

    const currentAllocations = activeAllocations.filter(
      (a) => a.startTime.toMillis() <= now && a.endTime.toMillis() >= now
    )

    // Filtra as que já têm sessão SSH ativa
    const pendingRequests = []
    for (const alloc of currentAllocations) {
      const existingSession = await SshSession.query()
        .where('allocationId', alloc.id)
        .where('status', 'active')
        .first()

      if (!existingSession && alloc.$extras._sshRequested) {
        pendingRequests.push({
          allocationId: alloc.id,
          userId: alloc.userId,
          userEmail: alloc.user?.email,
          userName: alloc.user?.fullName,
          systemUsername: machine.systemUsername,
          endTime: alloc.endTime.toISO(),
        })
      }
    }

    // Busca também requests marcados na tabela ssh_sessions com status 'pending' não existente
    // Abordagem alternativa: buscar por sessions com flag _sshRequested
    // Simplificação: incluir qualquer alocação ativa com flag de request
    const pendingSessions = await SshSession.query()
      .where('machineId', machine.id)
      .where('status', 'active')
      .whereNull('publicKeyFingerprint')

    // Na prática, o fluxo é: user solicita → API cria SshSession sem fingerprint →
    // agent faz polling → gera chave → reporta setup com fingerprint
    const pendingFromDb = []
    for (const session of pendingSessions) {
      const alloc = await Allocation.query()
        .where('id', session.allocationId)
        .preload('user')
        .first()

      if (alloc) {
        pendingFromDb.push({
          sessionId: session.id,
          allocationId: session.allocationId,
          userId: session.userId,
          userEmail: alloc.user?.email,
          userName: alloc.user?.fullName,
          systemUsername: session.systemUsername,
          endTime: alloc.endTime.toISO(),
        })
      }
    }

    // Busca sessões que o admin revogou manualmente e o agente ainda não processou
    const pendingRevocations = await SshSession.query()
      .where('machineId', machine.id)
      .where('status', 'revoked')
      .whereNotNull('publicKeyFingerprint')
      .whereNull('revokedAt')

    const revocations = pendingRevocations.map((s) => ({
      sessionId: s.id,
      fingerprint: s.publicKeyFingerprint,
      systemUsername: s.systemUsername,
    }))

    // Marca como processadas (revokedAt = agora) para não re-entregar
    for (const s of pendingRevocations) {
      s.revokedAt = DateTime.now()
      await s.save()
    }

    return response.ok({ pending: pendingFromDb, pendingRevocations: revocations })
  }

  /**
   * O agente reporta que configurou uma sessão SSH com sucesso.
   * Envia a chave privada gerada para que a API entregue ao frontend.
   *
   * POST /api/agent/ssh/setup
   */
  async sshSetupReport({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(sshSetupReportValidator)

    // Verifica se a alocação pertence a esta máquina
    const allocation = await Allocation.query()
      .where('id', data.allocationId)
      .where('machineId', machine.id)
      .where('status', 'approved')
      .first()

    if (!allocation) {
      return response.notFound({
        code: 'ALLOCATION_NOT_FOUND',
        message: 'Alocação não encontrada ou não pertence a esta máquina.',
      })
    }

    // Atualiza a sessão pendente com o fingerprint
    const session = await SshSession.query()
      .where('allocationId', data.allocationId)
      .where('machineId', machine.id)
      .where('status', 'active')
      .first()

    if (!session) {
      return response.notFound({
        code: 'SESSION_NOT_FOUND',
        message: 'Nenhuma sessão SSH pendente para esta alocação.',
      })
    }

    session.publicKeyFingerprint = data.publicKeyFingerprint
    session.systemUsername = data.systemUsername
    await session.save()

    // Armazena a chave privada temporariamente em memória para entrega ao frontend
    // Usa um Map singleton para isso (chave expira junto com a sessão)
    sshKeyStore.set(session.id, {
      privateKey: data.privateKey,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutos para download
    })

    return response.ok({
      success: true,
      sessionId: session.id,
      message: 'Sessão SSH configurada com sucesso. Chave pronta para entrega.',
    })
  }

  /**
   * O agente reporta que removeu uma sessão SSH (cleanup).
   *
   * POST /api/agent/ssh/teardown
   */
  async sshTeardownReport({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(sshTeardownReportValidator)

    const sessions = await SshSession.query()
      .where('allocationId', data.allocationId)
      .where('machineId', machine.id)
      .where('status', 'active')

    for (const session of sessions) {
      session.status = 'revoked'
      session.revokedAt = DateTime.now()
      await session.save()
      sshKeyStore.delete(session.id)
    }

    return response.ok({
      success: true,
      revokedCount: sessions.length,
      message: 'Sessões SSH revogadas com sucesso.',
    })
  }
}

// ============================================================
// Store temporário de chaves privadas (em memória)
// ============================================================

interface StoredKey {
  privateKey: string
  expiresAt: number
}

class SshKeyStore {
  private store = new Map<number, StoredKey>()

  set(sessionId: number, data: StoredKey) {
    this.store.set(sessionId, data)
    // Auto-cleanup após expiração
    setTimeout(() => this.store.delete(sessionId), data.expiresAt - Date.now())
  }

  get(sessionId: number): string | null {
    const entry = this.store.get(sessionId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.store.delete(sessionId)
      return null
    }
    return entry.privateKey
  }

  delete(sessionId: number) {
    this.store.delete(sessionId)
  }
}

export const sshKeyStore = new SshKeyStore()
