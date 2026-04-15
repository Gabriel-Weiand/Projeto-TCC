import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Machine from '#models/machine'
import SshSession from '#models/ssh_session'
import { sshKeyStore } from '#controllers/agent_controller'
import { summarizeAllocation } from '#services/allocation_summarizer'
import {
  createAllocationValidator,
  updateAllocationValidator,
  listAllocationsValidator,
} from '#validators/allocation'

export default class AllocationsController {
  /**
   * Lista alocações com filtros opcionais.
   * - User normal: vê apenas suas próprias alocações
   * - Admin: vê todas
   *
   * GET /api/v1/allocations
   */
  async index({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const {
      userId,
      machineId,
      status,
      page = 1,
      limit = 20,
    } = await request.validateUsing(listAllocationsValidator)

    let query = Allocation.query().preload('user').preload('machine').orderBy('startTime', 'desc')

    // User normal só vê suas próprias alocações (excluindo as ocultas)
    if (user.role !== 'admin') {
      query = query.where('userId', user.id).where('userHidden', false)
    } else if (userId) {
      // Admin pode filtrar por userId
      query = query.where('userId', userId)
    }

    if (machineId) query = query.where('machineId', machineId)
    if (status) query = query.where('status', status)

    const allocations = await query.paginate(page, limit)

    return response.ok(allocations)
  }

  /**
   * Cria uma nova alocação (reserva).
   * - User normal: cria alocação para si mesmo (userId vem do auth)
   * - Admin: pode criar alocação para qualquer usuário
   *
   * POST /api/v1/allocations
   */
  async store({ auth, request, response }: HttpContext) {
    const currentUser = auth.user!
    const data = await request.validateUsing(createAllocationValidator)

    // Define o userId: Admin pode especificar, user normal usa seu próprio id
    let targetUserId: number
    if (currentUser.role === 'admin' && data.userId) {
      targetUserId = data.userId
    } else {
      targetUserId = currentUser.id
    }

    // Verifica se a máquina existe e não está em manutenção
    const machine = await Machine.findOrFail(data.machineId)
    if (machine.status === 'maintenance') {
      return response.badRequest({
        code: 'MACHINE_IN_MAINTENANCE',
        message: 'Esta máquina está em manutenção e não pode receber alocações.',
      })
    }

    // Timestamps em milissegundos para comparação
    const newStart = data.startTime.toMillis()
    const newEnd = data.endTime.toMillis()

    // Busca todas as alocações ativas da máquina
    const existingAllocations = await Allocation.query()
      .where('machineId', data.machineId)
      .whereIn('status', ['approved', 'pending'])

    // Gap mínimo obrigatório entre alocações (5 minutos)
    const GAP_MS = 5 * 60 * 1000

    // Verifica conflito de horário em JavaScript
    // Considera gap de 5 minutos entre alocações
    const conflict = existingAllocations.find((allocation) => {
      const existingStart = allocation.startTime.toMillis()
      const existingEnd = allocation.endTime.toMillis()
      // Conflito: nova alocação precisa começar 5min depois da anterior terminar
      // e terminar 5min antes da próxima começar
      return newStart < existingEnd + GAP_MS && newEnd + GAP_MS > existingStart
    })

    if (conflict) {
      return response.conflict({
        code: 'ALLOCATION_CONFLICT',
        message: 'Já existe uma alocação neste horário para esta máquina.',
        conflictingAllocation: conflict.id,
      })
    }

    const allocation = await Allocation.create({
      ...data,
      userId: targetUserId,
    })
    await allocation.load('user')
    await allocation.load('machine')

    return response.created(allocation)
  }

  /**
   * Atualiza uma alocação (status, horário, etc).
   * - User normal: só pode cancelar suas próprias alocações (approved → cancelled)
   * - Admin: pode alterar qualquer alocação para qualquer status
   *
   * PATCH /api/v1/allocations/:id
   */
  async update({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)
    const data = await request.validateUsing(updateAllocationValidator)

    // Regras para usuário normal
    if (user.role !== 'admin') {
      // Só pode alterar suas próprias alocações
      if (allocation.userId !== user.id) {
        return response.forbidden({
          code: 'NOT_OWNER',
          message: 'Você só pode alterar suas próprias alocações.',
        })
      }

      // Só pode cancelar (não pode mudar para outros status)
      if (data.status && data.status !== 'cancelled') {
        return response.forbidden({
          code: 'INVALID_STATUS_CHANGE',
          message: 'Você só pode cancelar suas alocações.',
        })
      }

      // Só pode cancelar se estiver pendente ou aprovada
      if (data.status === 'cancelled' && !['approved', 'pending'].includes(allocation.status)) {
        return response.forbidden({
          code: 'CANNOT_CANCEL',
          message: 'Só é possível cancelar alocações com status pendente ou aprovado.',
        })
      }

      // User normal não pode alterar horários
      if (data.startTime || data.endTime) {
        return response.forbidden({
          code: 'CANNOT_CHANGE_TIME',
          message: 'Você não pode alterar os horários da alocação.',
        })
      }
    }

    allocation.merge(data)
    await allocation.save()

    await allocation.load('user')
    await allocation.load('machine')

    return response.ok(allocation)
  }

  /**
   * Soft-delete de uma alocação pelo usuário.
   * Oculta a alocação do histórico do usuário, mas mantém o registro para o admin.
   * - Se a alocação está pendente/aprovada e ainda não começou → cancela + oculta
   * - Se a alocação já foi finalizada/cancelada/negada → apenas oculta
   * - Não permite ocultar alocação em andamento
   *
   * DELETE /api/v1/allocations/:id
   */
  async softDelete({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)

    // Verificar propriedade (admin pode fazer soft-delete em qualquer uma)
    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({
        code: 'NOT_OWNER',
        message: 'Você só pode remover suas próprias alocações.',
      })
    }

    const now = Date.now()
    const startMs = allocation.startTime.toMillis()
    const endMs = allocation.endTime.toMillis()

    // Verificar se está em andamento (já começou mas não terminou)
    if (now >= startMs && now < endMs && ['approved'].includes(allocation.status)) {
      return response.forbidden({
        code: 'ALLOCATION_IN_PROGRESS',
        message: 'Não é possível remover uma alocação em andamento.',
      })
    }

    // Se pendente ou aprovada e ainda não começou → cancela automaticamente
    if (['pending', 'approved'].includes(allocation.status) && now < startMs) {
      allocation.status = 'cancelled'
    }

    allocation.userHidden = true
    await allocation.save()

    return response.ok({
      message: 'Alocação removida do seu histórico.',
      id: allocation.id,
      status: allocation.status,
    })
  }

  /**
   * Histórico de alocações de um usuário.
   *
   * GET /api/v1/users/:id/allocations
   */
  async userHistory({ params, request, response }: HttpContext) {
    const { page = 1, limit = 20 } = request.qs()

    const allocations = await Allocation.query()
      .where('userId', params.id)
      .preload('machine')
      .preload('metric')
      .orderBy('startTime', 'desc')
      .paginate(page, limit)

    return response.ok(allocations)
  }

  /**
   * Histórico de alocações de uma máquina.
   * - User normal: vê apenas horários (anonimizado)
   * - Admin: vê tudo incluindo dados do usuário
   *
   * GET /api/v1/machines/:id/allocations
   */
  async machineHistory({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const { page = 1, limit = 20 } = request.qs()

    const query = Allocation.query()
      .where('machineId', params.id)
      .preload('metric')
      .orderBy('startTime', 'desc')

    // Admin vê dados do usuário, user normal não
    if (user.role === 'admin') {
      query.preload('user')
    }

    const allocations = await query.paginate(page, limit)

    // Para user normal, retorna apenas dados anonimizados
    if (user.role !== 'admin') {
      const anonymized = allocations.serialize()
      anonymized.data = anonymized.data.map((allocation: Record<string, unknown>) => ({
        id: allocation.id,
        machineId: allocation.machineId,
        startTime: allocation.startTime,
        endTime: allocation.endTime,
        status: allocation.status,
        // Sem userId, user, reason, metric
      }))
      return response.ok(anonymized)
    }

    return response.ok(allocations)
  }

  /**
   * Gera resumo/métricas de uma sessão (alocação).
   * Consolida telemetrias do período em AllocationMetric.
   *
   * POST /api/v1/allocations/:id/summary
   */
  async summarizeSession({ params, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await allocation.load('machine')

    // Verifica se já existe métrica
    const existing = await AllocationMetric.findBy('allocationId', allocation.id)
    if (existing) {
      return response.conflict({
        code: 'SUMMARY_EXISTS',
        message: 'Esta alocação já possui um resumo.',
      })
    }

    const metric = await summarizeAllocation(allocation)

    if (!metric) {
      return response.notFound({
        code: 'NO_TELEMETRY',
        message: 'Não há dados de telemetria para este período.',
      })
    }

    return response.created(metric)
  }

  /**
   * Retorna o resumo/métricas de uma sessão.
   * - User normal: só pode ver suas próprias alocações
   * - Admin: pode ver todas
   *
   * GET /api/v1/allocations/:id/summary
   */
  async getSessionSummary({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)

    // User normal só pode ver suas próprias alocações
    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({
        code: 'NOT_OWNER',
        message: 'Você só pode visualizar o resumo das suas próprias alocações.',
      })
    }

    await allocation.load('metric')

    if (!allocation.metric) {
      return response.notFound({
        code: 'NO_SUMMARY',
        message: 'Esta alocação ainda não possui um resumo.',
      })
    }

    return response.ok(allocation.metric)
  }

  // ============================================================
  // SSH Access (Server Agent)
  // ============================================================

  /**
   * Solicita acesso SSH para uma alocação ativa.
   * Cria uma SshSession pendente que o agente servidor vai detectar via polling.
   * Se a chave já estiver pronta, retorna o download imediatamente.
   *
   * POST /api/v1/allocations/:id/ssh-access
   */
  async requestSshAccess({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)

    // Verificar propriedade
    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({
        code: 'NOT_OWNER',
        message: 'Você só pode solicitar SSH para suas próprias alocações.',
      })
    }

    // Verificar se alocação está ativa agora
    const now = DateTime.now().toMillis()
    if (allocation.status !== 'approved' || allocation.startTime.toMillis() > now || allocation.endTime.toMillis() < now) {
      return response.badRequest({
        code: 'ALLOCATION_NOT_ACTIVE',
        message: 'A alocação não está ativa no momento.',
      })
    }

    // Verificar se a máquina tem system_username configurado
    const machine = await Machine.findOrFail(allocation.machineId)
    if (!machine.systemUsername) {
      return response.badRequest({
        code: 'NO_SYSTEM_USER',
        message: 'Esta máquina não possui um usuário de sistema configurado para SSH.',
      })
    }

    // Verificar se já existe sessão SSH ativa para esta alocação
    let session = await SshSession.query()
      .where('allocationId', allocation.id)
      .where('status', 'active')
      .first()

    if (session && session.publicKeyFingerprint) {
      // Chave já foi gerada pelo agente. Verificar se a privada ainda está disponível
      const privateKey = sshKeyStore.get(session.id)
      if (privateKey) {
        // Entrega a chave e remove do store (single-use)
        sshKeyStore.delete(session.id)
        return response.ok({
          status: 'ready',
          privateKey,
          systemUsername: session.systemUsername,
          machineIp: machine.ipAddress,
          expiresAt: allocation.endTime.toISO(),
        })
      }
      return response.ok({
        status: 'expired',
        message: 'A chave já foi entregue ou expirou. Solicite novamente.',
      })
    }

    if (session) {
      // Sessão pendente mas agente ainda não gerou a chave
      return response.ok({
        status: 'pending',
        message: 'Aguardando o agente gerar a chave SSH. Tente novamente em alguns segundos.',
      })
    }

    // Criar nova sessão SSH pendente (agente vai detectar via polling)
    session = await SshSession.create({
      allocationId: allocation.id,
      machineId: machine.id,
      userId: user.id,
      systemUsername: machine.systemUsername,
      publicKeyFingerprint: '', // Será preenchido pelo agente
      status: 'active',
      expiresAt: allocation.endTime,
    })

    return response.created({
      status: 'pending',
      sessionId: session.id,
      message: 'Solicitação de SSH enviada. O agente irá gerar a chave. Tente novamente em ~5 segundos.',
    })
  }

}
