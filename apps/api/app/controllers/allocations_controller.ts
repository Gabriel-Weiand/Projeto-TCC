import type { HttpContext } from '@adonisjs/core/http'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Telemetry from '#models/telemetry'
import Machine from '#models/machine'
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
    const { userId, machineId, status, page = 1, limit = 20 } = 
      await request.validateUsing(listAllocationsValidator)

    let query = Allocation.query()
      .preload('user')
      .preload('machine')
      .orderBy('startTime', 'desc')

    // User normal só vê suas próprias alocações
    if (user.role !== 'admin') {
      query = query.where('userId', user.id)
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
      return (newStart < existingEnd + GAP_MS) && (newEnd + GAP_MS > existingStart)
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

      // Só pode cancelar se estiver aprovada
      if (data.status === 'cancelled' && allocation.status !== 'approved') {
        return response.forbidden({
          code: 'CANNOT_CANCEL',
          message: 'Só é possível cancelar alocações com status aprovado.',
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

    // Busca telemetrias da alocação (agora diretamente pelo allocationId)
    const telemetries = await Telemetry.query()
      .where('allocationId', allocation.id)

    if (telemetries.length === 0) {
      return response.notFound({
        code: 'NO_TELEMETRY',
        message: 'Não há dados de telemetria para este período.',
      })
    }

    // Calcula métricas agregadas
    const metrics = this.calculateMetrics(telemetries, allocation)

    const allocationMetric = await AllocationMetric.create({
      allocationId: allocation.id,
      ...metrics,
    })

    return response.created(allocationMetric)
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

  /**
   * Calcula métricas agregadas a partir das telemetrias.
   */
  private calculateMetrics(telemetries: Telemetry[], allocation: Allocation) {
    // Funções auxiliares (float: sem arredondamento para inteiro)
    const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
    const max = (values: number[]) => Math.max(...values)

    // Extrai valores
    const cpuUsages = telemetries.map((t) => t.cpuUsage)
    const cpuTemps = telemetries.map((t) => t.cpuTemp)
    const gpuUsages = telemetries.map((t) => t.gpuUsage)
    const gpuTemps = telemetries.map((t) => t.gpuTemp)
    const ramUsages = telemetries.map((t) => t.ramUsage)
    const diskUsages = telemetries.map((t) => t.diskUsage).filter((t): t is number => t !== null)
    const downloadUsages = telemetries.map((t) => t.downloadUsage).filter((t): t is number => t !== null)
    const uploadUsages = telemetries.map((t) => t.uploadUsage).filter((t): t is number => t !== null)
    const moboTemps = telemetries.map((t) => t.moboTemperature).filter((t): t is number => t !== null)

    // Calcula duração em minutos
    const durationMs = allocation.endTime.diff(allocation.startTime).milliseconds
    const sessionDurationMinutes = Math.round(durationMs / 60000)

    return {
      avgCpuUsage: avg(cpuUsages),
      maxCpuUsage: max(cpuUsages),
      avgCpuTemp: avg(cpuTemps),
      maxCpuTemp: max(cpuTemps),

      avgGpuUsage: avg(gpuUsages),
      maxGpuUsage: max(gpuUsages),
      avgGpuTemp: avg(gpuTemps),
      maxGpuTemp: max(gpuTemps),

      avgRamUsage: avg(ramUsages),
      maxRamUsage: max(ramUsages),

      avgDiskUsage: diskUsages.length > 0 ? avg(diskUsages) : null,
      maxDiskUsage: diskUsages.length > 0 ? max(diskUsages) : null,

      avgDownloadUsage: downloadUsages.length > 0 ? avg(downloadUsages) : null,
      maxDownloadUsage: downloadUsages.length > 0 ? max(downloadUsages) : null,
      avgUploadUsage: uploadUsages.length > 0 ? avg(uploadUsages) : null,
      maxUploadUsage: uploadUsages.length > 0 ? max(uploadUsages) : null,

      avgMoboTemp: moboTemps.length > 0 ? avg(moboTemps) : null,
      maxMoboTemp: moboTemps.length > 0 ? max(moboTemps) : null,

      sessionDurationMinutes,
    }
  }
}
