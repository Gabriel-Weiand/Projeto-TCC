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
      const newStatus = connectedUsers.length > 0 ? 'occupied' : 'available'

      // Como arrays são objetos em JS, convertemos para JSON string para comparar se houve mudança real
      const currentUsersStr = JSON.stringify(machine.activeUsers || [])
      const newUsersStr = JSON.stringify(connectedUsers || [])

      if (currentUsersStr !== newUsersStr || machine.status !== newStatus) {
        machine.activeUsers = connectedUsers // Mudou de loggedUser para activeUsers
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

    // === Determina se deve bloquear ===
    let shouldBlock = false
    let blockReason: string | null = null

    if (machine.status === 'maintenance') {
      shouldBlock = true
      blockReason = 'MACHINE_MAINTENANCE'
    } else if (connectedUsers.length > 0 && !currentAllocation) {
      shouldBlock = true
      blockReason = 'NO_VALID_ALLOCATION'
    }

    // === Lógica de Configuração Dinâmica (Eco vs Turbo) ===
    let agentConfig = {
      telemetry: {
        intervalSeconds: 15,
        batchSize: 4,
        processReporting: { enabled: true, topProcessesCount: 5, allProcesses: false },
        telemetrySet: {
          cpu: true,
          gpu: true,
          ramAndSwap: true,
          diskSpace: false,
          diskIO: true,
          networkIO: true,
          temperatures: true,
          activeUsers: true,
        },
      },
      sshAccess: { enforceSessionLimits: true, idleTimeoutMinutes: 30 },
      maintenance: { wipeDataOnTeardown: true, blockLocalLogin: false },
      thermalRules: {
        enableEmergencyAlerts: true,
        cpuTempMaxCelcius: 90.0,
        gpuTempMaxCelcius: 85.0,
        actionOnOverheat: 'throttle_and_alert',
      },
    }

    if (machine.status === 'occupied') {
      // PRESET TURBO: Máquina em uso. Alta resolução de dados.
      agentConfig.telemetry.intervalSeconds = 5
      agentConfig.telemetry.batchSize = 6 // Envia a cada 30 segundos (5s * 6)
      agentConfig.telemetry.telemetrySet.diskSpace = true
    } else {
      // PRESET ECO: Máquina disponível/ociosa. Baixa resolução para poupar rede/banco.
      agentConfig.telemetry.intervalSeconds = 6
      agentConfig.telemetry.batchSize = 3 // Envia imediatamente a cada 1 minuto
      agentConfig.telemetry.telemetrySet.diskIO = false
      agentConfig.telemetry.telemetrySet.networkIO = false
      agentConfig.telemetry.processReporting.enabled = true
    }

    return response.ok({
      machine: {
        id: machine.id,
        name: machine.name,
        status: machine.status,
      },
      connectedUsers,
      connectedCount: connectedUsers.length,
      currentAllocation: currentAllocation
        ? {
            id: currentAllocation.id,
            userId: currentAllocation.userId,
            userName: currentAllocation.user?.fullName,
            startTime: currentAllocation.startTime,
            endTime: currentAllocation.endTime,
          }
        : null,
      shouldBlock,
      blockReason,
      agentConfig,
    })
  }

  /**
   * Sincroniza especificações de hardware detectadas pelo agente,
   * incluindo a lista de partições de disco.
   *
   * PUT /api/agent/sync-specs
   */
  async syncSpecs({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(syncSpecsValidator)

    // Separa discos dos dados da máquina (tipagem como any para aceitar payloads externos)
    const { disks, ...machineData } = data as any
    // Merge dos dados e persiste discos como JSON em `machines.disks`.
    machine.merge(machineData)

    if (disks !== undefined) {
      let kept: any[] = []
      if (Array.isArray(disks)) {
        // Preferir partição de montagem raiz '/' somente
        kept = disks.filter((d) => d.mountpoint === '/')
        // Se não encontrar '/', tenta escolher uma partição plausível (evita '/boot/efi')
        if (kept.length === 0) {
          kept = disks.filter((d) => d.mountpoint && d.mountpoint !== '/boot/efi').slice(0, 1)
        }
      }

      machine.disksJson = JSON.stringify(kept)
    }

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
      disks: disks ?? [],
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
    // Valida e extrai o novo dicionário único 'data'
    const { data } = await request.validateUsing(telemetryReportValidator)

    // Busca alocação atual
    const currentAllocation = await this.findCurrentAllocation(machine.id)
    const allocationId = currentAllocation ? currentAllocation.id : 0

    // Atualiza o cache realtime com TODAS as telemetrias do lote na ordem correta,
    // para que o ring buffer tenha o histórico completo para o playback do frontend.
    if (data.length > 0) {
      for (const item of data) {
        telemetryBuffer.updateRealtime(machine.id, { allocationId, ...item })
      }
    }

    // Persiste todas as telemetrias no buffer se houver alocação
    if (currentAllocation) {
      for (const item of data) {
        telemetryBuffer.add(machine.id, { allocationId, ...item })
      }
    }

    // Atualiza status da máquina
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

  async sshPendingRequests({ authenticatedMachine, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now().toMillis()

    const activeAllocations = await Allocation.query()
      .where('machineId', machine.id)
      .where('status', 'approved')
      .preload('user')

    const currentAllocations = activeAllocations.filter(
      (a) => a.startTime.toMillis() <= now && a.endTime.toMillis() >= now
    )

    const pendingSessions = await SshSession.query()
      .where('machineId', machine.id)
      .where('status', 'active')
      .whereNull('publicKeyFingerprint')

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

    for (const s of pendingRevocations) {
      s.revokedAt = DateTime.now()
      await s.save()
    }

    return response.ok({ pending: pendingFromDb, pendingRevocations: revocations })
  }

  async sshSetupReport({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(sshSetupReportValidator)

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

    sshKeyStore.set(session.id, {
      privateKey: data.privateKey,
      expiresAt: Date.now() + 5 * 60 * 1000,
    })

    return response.ok({
      success: true,
      sessionId: session.id,
      message: 'Sessão SSH configurada com sucesso. Chave pronta para entrega.',
    })
  }

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
