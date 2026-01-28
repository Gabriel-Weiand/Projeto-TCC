import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import User from '#models/user'
import Allocation from '#models/allocation'
import { telemetryReportValidator } from '#validators/telemetry'
import { validateUserValidator, reportLoginValidator, syncSpecsValidator } from '#validators/agent'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { machineCache } from '#services/machine_cache'

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

    return allocations.find(
      (a) => a.startTime.toMillis() <= now && a.endTime.toMillis() >= now
    ) || null
  }

  /**
   * Helper: Encontra alocações futuras (que ainda não terminaram).
   */
  private async findFutureAllocations(machineId: number, userId?: number) {
    const now = DateTime.now().toMillis()

    let query = Allocation.query()
      .where('machineId', machineId)
      .whereIn('status', ['approved', 'pending'])
      .preload('user')
      .orderBy('startTime', 'asc')

    if (userId) {
      query = query.where('userId', userId)
    }

    const allocations = await query

    return allocations.filter((a) => a.endTime.toMillis() >= now)
  }

  /**
   * Helper: Encontra próxima alocação de um usuário.
   */
  private async findNextAllocation(machineId: number, userId: number) {
    const now = DateTime.now().toMillis()

    const allocations = await Allocation.query()
      .where('machineId', machineId)
      .where('userId', userId)
      .where('status', 'approved')
      .orderBy('startTime', 'asc')

    return allocations.find((a) => a.startTime.toMillis() > now) || null
  }

  /**
   * Heartbeat - Mantém a máquina online e retorna status de controle.
   * O agente deve chamar esta rota periodicamente (a cada 30s).
   * 
   * POST /api/agent/heartbeat
   */
  async heartbeat({ authenticatedMachine, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now()

    // Atualiza último contato
    machine.lastSeenAt = now
    if (machine.status === 'offline') {
      machine.status = 'available'
    }
    await machine.save()

    // Verifica se há alocação ativa agora
    const currentAllocation = await this.findCurrentAllocation(machine.id)

    // Verifica se deve bloquear (máquina em manutenção)
    const shouldBlock = machine.status === 'maintenance'

    return response.ok({
      machine: {
        id: machine.id,
        name: machine.name,
        status: machine.status,
      },
      currentAllocation: currentAllocation
        ? {
            id: currentAllocation.id,
            userId: currentAllocation.userId,
            userEmail: currentAllocation.user.email,
            userName: currentAllocation.user.fullName,
            startTime: currentAllocation.startTime,
            endTime: currentAllocation.endTime,
          }
        : null,
      shouldBlock,
      serverTime: now.toISO(),
    })
  }

  /**
   * Valida credenciais de um usuário e verifica se tem alocação ativa.
   * Usado quando o usuário tenta logar na máquina física.
   * 
   * POST /api/agent/validate-user
   */
  async validateUser({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const { email, password } = await request.validateUsing(validateUserValidator)
    const now = DateTime.now()

    // Verifica credenciais do usuário
    let user: User
    try {
      user = await User.verifyCredentials(email, password)
    } catch {
      return response.unauthorized({
        allowed: false,
        reason: 'INVALID_CREDENTIALS',
        message: 'Email ou senha inválidos.',
      })
    }

    // Verifica se a máquina está em manutenção
    if (machine.status === 'maintenance') {
      return response.ok({
        allowed: false,
        reason: 'MACHINE_MAINTENANCE',
        message: 'Esta máquina está em manutenção.',
        user: { id: user.id, fullName: user.fullName, email: user.email },
      })
    }

    // Busca alocação ativa para este usuário nesta máquina
    const allocation = await this.findCurrentAllocation(machine.id, user.id)

    if (!allocation) {
      // Verifica se tem alguma alocação futura
      const futureAllocation = await this.findNextAllocation(machine.id, user.id)

      return response.ok({
        allowed: false,
        reason: 'NO_ACTIVE_ALLOCATION',
        message: 'Você não possui uma alocação ativa para esta máquina neste momento.',
        user: { id: user.id, fullName: user.fullName, email: user.email },
        nextAllocation: futureAllocation
          ? {
              id: futureAllocation.id,
              startTime: futureAllocation.startTime,
              endTime: futureAllocation.endTime,
            }
          : null,
      })
    }

    // Usuário autorizado!
    return response.ok({
      allowed: true,
      reason: 'AUTHORIZED',
      message: 'Acesso autorizado.',
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
      allocation: {
        id: allocation.id,
        startTime: allocation.startTime,
        endTime: allocation.endTime,
        remainingMinutes: Math.floor(allocation.endTime.diff(now, 'minutes').minutes),
      },
    })
  }

  /**
   * Retorna alocações da máquina (ativas e futuras).
   * 
   * GET /api/agent/allocations
   */
  async allocations({ authenticatedMachine, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now()

    const allocations = await this.findFutureAllocations(machine.id)

    return response.ok({
      machineId: machine.id,
      machineName: machine.name,
      allocations: allocations.map((a) => ({
        id: a.id,
        userId: a.userId,
        userEmail: a.user.email,
        userName: a.user.fullName,
        startTime: a.startTime,
        endTime: a.endTime,
        status: a.status,
        isCurrent:
          a.startTime.toMillis() <= now.toMillis() && a.endTime.toMillis() >= now.toMillis(),
      })),
    })
  }

  /**
   * Retorna a sessão/alocação atual (quem deveria estar usando agora).
   * 
   * GET /api/agent/current-session
   */
  async currentSession({ authenticatedMachine, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now()

    const allocation = await this.findCurrentAllocation(machine.id)

    if (!allocation) {
      return response.ok({
        hasActiveSession: false,
        session: null,
        machineStatus: machine.status,
      })
    }

    return response.ok({
      hasActiveSession: true,
      session: {
        allocationId: allocation.id,
        user: {
          id: allocation.user.id,
          email: allocation.user.email,
          fullName: allocation.user.fullName,
        },
        startTime: allocation.startTime,
        endTime: allocation.endTime,
        remainingMinutes: Math.floor(allocation.endTime.diff(now, 'minutes').minutes),
      },
      machineStatus: machine.status,
    })
  }

  /**
   * Verifica se o agente deve bloquear a máquina.
   * Útil para polling periódico durante uma sessão.
   * 
   * GET /api/agent/should-block
   */
  async shouldBlock({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now()

    // Parâmetro opcional: ID do usuário atualmente logado no SO
    const { loggedUserId } = request.qs()

    // Máquina em manutenção = sempre bloqueia
    if (machine.status === 'maintenance') {
      return response.ok({
        shouldBlock: true,
        reason: 'MACHINE_MAINTENANCE',
        message: 'Máquina em manutenção.',
      })
    }

    // Se informou o usuário logado, verifica se ele tem alocação ativa
    if (loggedUserId) {
      const allocation = await this.findCurrentAllocation(machine.id, Number(loggedUserId))

      if (!allocation) {
        return response.ok({
          shouldBlock: true,
          reason: 'ALLOCATION_EXPIRED_OR_REVOKED',
          message: 'Alocação expirou ou foi revogada.',
        })
      }

      // Alocação válida, não bloqueia
      return response.ok({
        shouldBlock: false,
        reason: 'VALID_ALLOCATION',
        allocation: {
          id: allocation.id,
          endTime: allocation.endTime,
          remainingMinutes: Math.floor(allocation.endTime.diff(now, 'minutes').minutes),
        },
      })
    }

    // Sem usuário informado, apenas verifica se há alguma alocação ativa
    const anyAllocation = await this.findCurrentAllocation(machine.id)

    return response.ok({
      shouldBlock: false,
      hasActiveAllocation: !!anyAllocation,
      machineStatus: machine.status,
    })
  }

  /**
   * Reporta que um usuário logou no SO da máquina.
   * 
   * POST /api/agent/report-login
   */
  async reportLogin({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const { username } = await request.validateUsing(reportLoginValidator)

    machine.loggedUser = username
    machine.status = 'occupied'
    await machine.save()

    // Invalida cache para refletir mudança imediatamente
    machineCache.invalidate(machine.token)

    return response.ok({
      registered: true,
      message: `Login de '${username}' registrado.`,
    })
  }

  /**
   * Reporta que o usuário deslogou do SO da máquina.
   * 
   * POST /api/agent/report-logout
   */
  async reportLogout({ authenticatedMachine, response }: HttpContext) {
    const machine = authenticatedMachine!

    const previousUser = machine.loggedUser
    machine.loggedUser = null
    machine.status = 'available'
    await machine.save()

    // Invalida cache para refletir mudança imediatamente
    machineCache.invalidate(machine.token)

    return response.ok({
      registered: true,
      message: previousUser ? `Logout de '${previousUser}' registrado.` : 'Logout registrado.',
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
        macAddress: machine.macAddress,
      },
    })
  }

  /**
   * Recebe telemetria do agente.
   * Os dados vão para o buffer e são persistidos periodicamente.
   * 
   * POST /api/agent/telemetry
   */
  async telemetry({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(telemetryReportValidator)

    // Adiciona ao buffer (não vai direto ao banco)
    telemetryBuffer.add({
      machineId: machine.id,
      ...data,
    })

    // Atualiza último contato
    machine.lastSeenAt = DateTime.now()
    if (machine.status === 'offline') {
      machine.status = 'available'
    }
    await machine.save()

    return response.noContent()
  }
}
