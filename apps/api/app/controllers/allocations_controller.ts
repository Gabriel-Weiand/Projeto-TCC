import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Machine from '#models/machine'
import { summarizeAllocation } from '#services/allocation_summarizer'
import {
  createAllocationValidator,
  updateAllocationValidator,
  listAllocationsValidator,
} from '#validators/allocation'
import { extendAllocationValidator } from '#validators/allocation'
import { assertAllocationEndWithinLimit } from '#services/lab_config'

export default class AllocationsController {
  /**
   * Lista apenas as alocações do utilizador autenticado.
   * GET /api/v1/allocations/my
   */
  async myAllocations({ auth, request, response }: HttpContext) {
    const user = auth.user!

    // Podemos reaproveitar o listAllocationsValidator para a paginação e status
    const { status, page = 1, limit = 20 } = await request.validateUsing(listAllocationsValidator)

    let query = Allocation.query()
      .where('userId', user.id)
      .where('userHidden', false)
      .preload('machine')
      .orderBy('startTime', 'desc')

    if (status) {
      query = query.where('status', status)
    }

    const allocations = await query.paginate(page, limit)

    return response.ok(allocations)
  }

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
   * Cria uma nova alocação.
   * Realiza validações de manutenção, conflito de horário (UTC) e regras de Sudo.
   * * POST /api/v1/allocations
   */
  async store({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(createAllocationValidator)

    // Forçar UTC para garantir consistência absoluta no banco (SQLite/Postgres)
    data.startTime = data.startTime.toUTC()
    data.endTime = data.endTime.toUTC()

    if (data.endTime <= data.startTime) {
      return response.badRequest({
        code: 'INVALID_RANGE',
        message: 'O horário de término deve ser posterior ao de início.',
      })
    }

    const futureLimitMsg = assertAllocationEndWithinLimit(data.endTime)
    if (futureLimitMsg) {
      return response.badRequest({
        code: 'ALLOCATION_TOO_FAR',
        message: futureLimitMsg,
      })
    }

    // 1. Verificação de Status da Máquina
    const machine = await Machine.findOrFail(data.machineId)
    if (machine.status === 'maintenance' || machine.status === 'offline') {
      return response.badRequest({
        code: 'MACHINE_IN_MAINTENANCE',
        message: 'A máquina selecionada está em manutenção ou offline.',
      })
    }

    // 2. Verificação de Conflito de Horário (Overlap Algorithm)
    // Há conflito se (NovoInicio < FimExistente) E (NovoFim > InicioExistente)
    // Apenas para status 'approved' ou 'pending'
    const conflict = await Allocation.query()
      .where('machineId', data.machineId)
      .whereIn('status', ['approved', 'pending'])
      .where('startTime', '<', data.endTime.toSQL()!)
      .where('endTime', '>', data.startTime.toSQL()!)
      .first()

    if (conflict) {
      return response.conflict({
        code: 'ALLOCATION_CONFLICT',
        message: 'Já existe uma reserva ativa para esta máquina neste horário.',
      })
    }

    // 3. Regras de Permissão e Sudo
    if (user.role !== 'admin') {
      data.userId = user.id // Trava o ID do usuário para ele mesmo
      data.status = data.isSudo ? 'pending' : 'approved'
    } else {
      // Admin pode criar para outros usuários e status é default 'approved'
      if (!data.userId) data.userId = user.id
      if (!data.status) data.status = 'approved'
    }

    const allocation = await Allocation.create(data)

    return response.created(allocation)
  }

  /**
   * Estende o tempo de uma alocação ativa (Grace Period).
   * * POST /api/v1/allocations/:id/extend
   */
  async extend({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const allocation = await Allocation.findOrFail(params.id)
    const { additionalMinutes } = await request.validateUsing(extendAllocationValidator)

    if (user.role !== 'admin' && allocation.userId !== user.id) {
      return response.forbidden({ message: 'Apenas o dono pode estender a alocação.' })
    }

    if (allocation.status !== 'approved') {
      return response.badRequest({ message: 'Apenas alocações ativas podem ser estendidas.' })
    }

    const now = DateTime.now()
    const end = allocation.endTime

    // Permite estender apenas se estiver durante a alocação ou no grace period (ex: até 5 min após o fim teórico)
    if (now > end.plus({ minutes: 5 })) {
      return response.badRequest({
        message: 'O tempo limite para extensão expirou (Grace Period encerrado).',
      })
    }

    const newEnd = end.plus({ minutes: additionalMinutes })
    const futureLimitMsg = assertAllocationEndWithinLimit(newEnd)
    if (futureLimitMsg) {
      return response.badRequest({
        code: 'ALLOCATION_TOO_FAR',
        message: futureLimitMsg,
      })
    }

    allocation.endTime = newEnd
    await allocation.save()

    return response.ok({
      message: `Alocação estendida em ${additionalMinutes} minutos com sucesso.`,
      newEndTime: allocation.endTime.toISO(),
    })
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
    // isOwn indica se a alocação pertence ao próprio usuário autenticado
    if (user.role !== 'admin') {
      const anonymized = allocations.serialize()
      anonymized.data = anonymized.data.map((allocation: Record<string, unknown>) => ({
        id: allocation.id,
        machineId: allocation.machineId,
        startTime: allocation.startTime,
        endTime: allocation.endTime,
        status: allocation.status,
        isOwn: allocation.userId === user.id,
        // Sem userId de terceiros, user, reason, metric
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
}
