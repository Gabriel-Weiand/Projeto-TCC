import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import User from '#models/user'
import Allocation from '#models/allocation'
import { telemetryReportValidator } from '#validators/telemetry'
import {
  validateUserValidator,
  reportLoginValidator,
  syncSpecsValidator,
  quickAllocateValidator,
} from '#validators/agent'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { machineCache } from '#services/machine_cache'

/**
 * Duração padrão de uma alocação rápida em minutos.
 */
const QUICK_ALLOCATION_DURATION_MINUTES = 60

/**
 * Tempo mínimo em minutos antes da próxima alocação para permitir alocação rápida.
 */
const QUICK_ALLOCATION_MIN_GAP_MINUTES = 20

/**
 * Gap mínimo obrigatório entre alocações consecutivas (em minutos).
 * Uma alocação não pode terminar a menos de 5 minutos do início da próxima.
 */
const ALLOCATION_GAP_MINUTES = 5

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
   * Helper: Encontra próxima alocação de um usuário específico.
   */
  private async findNextUserAllocation(machineId: number, userId: number) {
    const now = DateTime.now().toMillis()

    const allocations = await Allocation.query()
      .where('machineId', machineId)
      .where('userId', userId)
      .where('status', 'approved')
      .orderBy('startTime', 'asc')

    return allocations.find((a) => a.startTime.toMillis() > now) || null
  }

  /**
   * Helper: Busca alocações do dia para a máquina.
   */
  private async findDayAllocations(machineId: number, date: DateTime) {
    const startOfDay = date.startOf('day').toMillis()
    const endOfDay = date.endOf('day').toMillis()

    const allocations = await Allocation.query()
      .where('machineId', machineId)
      .whereIn('status', ['approved', 'pending'])
      .orderBy('startTime', 'asc')

    return allocations.filter((a) => {
      const allocStart = a.startTime.toMillis()
      const allocEnd = a.endTime.toMillis()
      return allocStart <= endOfDay && allocEnd >= startOfDay
    })
  }

  /**
   * Helper: Verifica se há conflito de horário para nova alocação.
   * Considera o gap obrigatório de 5 minutos entre alocações.
   */
  private async hasConflict(
    machineId: number,
    startTime: DateTime,
    endTime: DateTime
  ): Promise<boolean> {
    const startMs = startTime.toMillis()
    const endMs = endTime.toMillis()
    const gapMs = ALLOCATION_GAP_MINUTES * 60 * 1000

    const allocations = await Allocation.query()
      .where('machineId', machineId)
      .whereIn('status', ['approved', 'pending'])

    return allocations.some((a) => {
      const allocStart = a.startTime.toMillis()
      const allocEnd = a.endTime.toMillis()
      // Conflito considerando gap: nova alocação precisa terminar 5min antes da próxima
      // e começar 5min depois da anterior
      return (startMs < allocEnd + gapMs) && (endMs + gapMs > allocStart)
    })
  }

  /**
   * Heartbeat - Rota principal de polling do agente.
   * Atualiza último contato, retorna status da máquina e informações de controle.
   * 
   * Esta rota consolida heartbeat + should-block + info de alocação rápida.
   * O agente deve chamar periodicamente (a cada 30s) e também quando precisa
   * verificar se deve bloquear.
   * 
   * POST /api/agent/heartbeat
   * 
   * Query params opcionais:
   *   - loggedUserId: ID do usuário logado no SO (para verificar se deve bloquear)
   */
  async heartbeat({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now()

    // Atualiza último contato
    machine.lastSeenAt = now
    if (machine.status === 'offline') {
      machine.status = 'available'
    }
    await machine.save()

    // Parâmetro opcional: ID do usuário logado no SO
    const { loggedUserId } = request.qs()

    // Busca alocação atual do usuário (se informado) ou qualquer alocação ativa
    const currentAllocation = await this.findCurrentAllocation(
      machine.id,
      loggedUserId ? Number(loggedUserId) : undefined
    )

    // Busca próxima alocação da máquina
    const nextAllocation = await this.findNextAllocation(machine.id)

    // === Determina se deve bloquear ===
    let shouldBlock = false
    let blockReason: string | null = null

    if (machine.status === 'maintenance') {
      shouldBlock = true
      blockReason = 'MACHINE_MAINTENANCE'
    } else if (loggedUserId) {
      // Se informou usuário logado, verifica se tem alocação válida
      if (!currentAllocation) {
        shouldBlock = true
        blockReason = 'NO_VALID_ALLOCATION'
      }
    }

    // === Calcula info de alocação rápida ===
    const minutesUntilNext = nextAllocation
      ? Math.floor(nextAllocation.startTime.diff(now, 'minutes').minutes)
      : null

    const canQuickAllocate =
      !nextAllocation || minutesUntilNext! >= QUICK_ALLOCATION_MIN_GAP_MINUTES

    // Calcula duração máxima da alocação rápida (considera gap de 5min)
    let maxQuickDuration = QUICK_ALLOCATION_DURATION_MINUTES
    if (nextAllocation && canQuickAllocate) {
      maxQuickDuration = Math.min(maxQuickDuration, minutesUntilNext! - ALLOCATION_GAP_MINUTES)
    }

    return response.ok({
      machine: {
        id: machine.id,
        name: machine.name,
        status: machine.status,
      },
      // Alocação atual - COM info do usuário (só aparece se tem alocação)
      currentAllocation: currentAllocation
        ? {
            id: currentAllocation.id,
            userId: currentAllocation.userId,
            userName: currentAllocation.user?.fullName,
            userEmail: currentAllocation.user?.email,
            startTime: currentAllocation.startTime,
            endTime: currentAllocation.endTime,
            remainingMinutes: Math.floor(
              currentAllocation.endTime.diff(now, 'minutes').minutes
            ),
          }
        : null,
      // Próxima alocação - SEM nome do usuário (privacidade na tela de login)
      nextAllocation: nextAllocation
        ? {
            startTime: nextAllocation.startTime,
            endTime: nextAllocation.endTime,
            minutesUntilStart: minutesUntilNext,
          }
        : null,
      // Info para alocação rápida
      quickAllocate: {
        allowed: canQuickAllocate,
        maxDurationMinutes: canQuickAllocate ? maxQuickDuration : 0,
        minGapMinutes: QUICK_ALLOCATION_MIN_GAP_MINUTES,
        reason: canQuickAllocate
          ? null
          : `Próxima alocação em ${minutesUntilNext} minutos (mínimo: ${QUICK_ALLOCATION_MIN_GAP_MINUTES})`,
      },
      // Controle de bloqueio
      shouldBlock,
      blockReason,
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
      const futureAllocation = await this.findNextUserAllocation(machine.id, user.id)

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
   * Retorna agenda do dia da máquina.
   * Mostra apenas horários das alocações (SEM nome dos usuários) para privacidade.
   * Usado para mostrar calendário na tela de login do agente.
   * 
   * GET /api/agent/day-schedule
   * 
   * Query params opcionais:
   *   - date: Data no formato YYYY-MM-DD (padrão: hoje)
   */
  async daySchedule({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const now = DateTime.now()

    // Permite consultar data específica (útil para ver amanhã, etc)
    const { date } = request.qs()
    const targetDate = date ? DateTime.fromISO(date) : now

    if (!targetDate.isValid) {
      return response.badRequest({ error: 'Formato de data inválido. Use YYYY-MM-DD.' })
    }

    const allocations = await this.findDayAllocations(machine.id, targetDate)

    return response.ok({
      machineId: machine.id,
      machineName: machine.name,
      date: targetDate.toISODate(),
      // Lista de horários ocupados - SEM identificação do usuário
      slots: allocations.map((a) => ({
        startTime: a.startTime.toISO(),
        endTime: a.endTime.toISO(),
        // Indica se é o horário atual (para destacar na UI)
        isCurrent:
          a.startTime.toMillis() <= now.toMillis() && a.endTime.toMillis() >= now.toMillis(),
        // Indica se já passou
        isPast: a.endTime.toMillis() < now.toMillis(),
      })),
    })
  }

  /**
   * Cria uma alocação rápida (on-the-spot).
   * Permite que um usuário crie uma alocação instantânea se houver disponibilidade.
   * 
   * Regras:
   * - Deve ter pelo menos 20 minutos até a próxima alocação
   * - Duração máxima de 60 minutos (ou até 5min antes da próxima alocação)
   * - Requer credenciais válidas do usuário
   * - Gap de 5 minutos obrigatório entre alocações
   * 
   * POST /api/agent/quick-allocate
   */
  async quickAllocate({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const { email, password, durationMinutes } = await request.validateUsing(
      quickAllocateValidator
    )
    const now = DateTime.now()

    // === 1. Valida credenciais ===
    let user: User
    try {
      user = await User.verifyCredentials(email, password)
    } catch {
      return response.unauthorized({
        success: false,
        reason: 'INVALID_CREDENTIALS',
        message: 'Email ou senha inválidos.',
      })
    }

    // === 2. Verifica se máquina está disponível ===
    if (machine.status === 'maintenance') {
      return response.ok({
        success: false,
        reason: 'MACHINE_MAINTENANCE',
        message: 'Esta máquina está em manutenção.',
      })
    }

    // === 3. Verifica se já tem alocação ativa ===
    const currentAllocation = await this.findCurrentAllocation(machine.id)
    if (currentAllocation) {
      return response.conflict({
        success: false,
        reason: 'MACHINE_OCCUPIED',
        message: 'Já existe uma alocação ativa nesta máquina.',
      })
    }

    // === 4. Verifica regra dos 20 minutos ===
    const nextAllocation = await this.findNextAllocation(machine.id)
    const minutesUntilNext = nextAllocation
      ? Math.floor(nextAllocation.startTime.diff(now, 'minutes').minutes)
      : null

    if (nextAllocation && minutesUntilNext! < QUICK_ALLOCATION_MIN_GAP_MINUTES) {
      return response.conflict({
        success: false,
        reason: 'INSUFFICIENT_TIME',
        message: `Próxima alocação em ${minutesUntilNext} minutos. Mínimo necessário: ${QUICK_ALLOCATION_MIN_GAP_MINUTES} minutos.`,
        nextAllocation: {
          startTime: nextAllocation.startTime,
          minutesUntilStart: minutesUntilNext,
        },
      })
    }

    // === 5. Calcula duração efetiva ===
    let effectiveDuration = durationMinutes || QUICK_ALLOCATION_DURATION_MINUTES

    // Limita ao máximo permitido
    if (effectiveDuration > QUICK_ALLOCATION_DURATION_MINUTES) {
      effectiveDuration = QUICK_ALLOCATION_DURATION_MINUTES
    }

    // Se há próxima alocação, ajusta para respeitar gap de 5min
    if (nextAllocation) {
      const maxDuration = minutesUntilNext! - ALLOCATION_GAP_MINUTES
      if (effectiveDuration > maxDuration) {
        effectiveDuration = maxDuration
      }
    }

    // Duração mínima de 10 minutos
    if (effectiveDuration < 10) {
      return response.conflict({
        success: false,
        reason: 'DURATION_TOO_SHORT',
        message: 'Tempo disponível insuficiente para alocação (mínimo 10 minutos).',
      })
    }

    // === 6. Calcula horários ===
    const startTime = now
    const endTime = now.plus({ minutes: effectiveDuration })

    // === 7. Verificação final de conflito (safety check) ===
    const hasConflict = await this.hasConflict(machine.id, startTime, endTime)
    if (hasConflict) {
      return response.conflict({
        success: false,
        reason: 'CONFLICT_DETECTED',
        message: 'Conflito de horário detectado. Tente novamente.',
      })
    }

    // === 8. Cria a alocação ===
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime,
      endTime,
      status: 'approved', // Aprovação automática para alocação rápida
    })

    return response.created({
      success: true,
      reason: 'ALLOCATION_CREATED',
      message: `Alocação criada com sucesso! Você tem ${effectiveDuration} minutos.`,
      allocation: {
        id: allocation.id,
        startTime: allocation.startTime,
        endTime: allocation.endTime,
        durationMinutes: effectiveDuration,
      },
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      },
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
      },
    })
  }

  /**
   * Recebe telemetria do agente.
   * Os dados vão para o buffer e são persistidos periodicamente.
   * Telemetria só é aceita se houver uma alocação ativa na máquina.
   * 
   * POST /api/agent/telemetry
   */
  async telemetry({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(telemetryReportValidator)

    // Busca alocação ativa nesta máquina (qualquer usuário)
    const currentAllocation = await this.findCurrentAllocation(machine.id)

    if (!currentAllocation) {
      // Sem alocação ativa = telemetria descartada (não há contexto para persistência)
      // Atualiza apenas o último contato
      machine.lastSeenAt = DateTime.now()
      if (machine.status === 'offline') {
        machine.status = 'available'
      }
      await machine.save()

      return response.noContent()
    }

    // Adiciona ao buffer com allocationId (não vai direto ao banco)
    telemetryBuffer.add(machine.id, {
      allocationId: currentAllocation.id,
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
