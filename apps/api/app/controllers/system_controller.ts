import type { HttpContext } from '@adonisjs/core/http'
import Telemetry from '#models/telemetry'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import {
  pruneTelemetriesValidator,
  pruneAllocationsValidator,
  pruneMetricsValidator,
} from '#validators/system'

export default class SystemController {
  /**
   * Remove telemetrias de alocações antigas.
   * Identifica alocações anteriores à data e remove suas telemetrias.
   * 
   * DELETE /api/v1/system/prune/telemetries
   */
  async pruneTelemetries({ request, response }: HttpContext) {
    const { before, machineId } = await request.validateUsing(pruneTelemetriesValidator)

    // Busca alocações anteriores à data (finalizadas/canceladas)
    let allocQuery = Allocation.query()
      .where('endTime', '<', before)
      .whereIn('status', ['finished', 'cancelled'])

    if (machineId) {
      allocQuery = allocQuery.where('machineId', machineId)
    }

    const allocations = await allocQuery.select('id')
    const allocationIds = allocations.map((a) => a.id)

    if (allocationIds.length === 0) {
      return response.ok({
        message: 'Nenhuma telemetria para remover.',
        deleted: 0,
      })
    }

    const deleted = await Telemetry.query()
      .whereIn('allocationId', allocationIds)
      .delete()

    return response.ok({
      message: 'Telemetrias removidas com sucesso.',
      deleted: deleted[0] ?? 0,
    })
  }

  /**
   * Remove alocações antigas (finalizadas/canceladas).
   * 
   * DELETE /api/v1/system/prune/allocations
   */
  async pruneAllocations({ request, response }: HttpContext) {
    const { before, status = ['finished', 'cancelled'], userId, machineId } = 
      await request.validateUsing(pruneAllocationsValidator)

    let query = Allocation.query()
      .where('endTime', '<', before)
      .whereIn('status', status)

    if (userId) {
      query = query.where('userId', userId)
    }

    if (machineId) {
      query = query.where('machineId', machineId)
    }

    const deleted = await query.delete()

    return response.ok({
      message: 'Alocações removidas com sucesso.',
      deleted: deleted[0] ?? 0,
    })
  }

  /**
   * Remove métricas de alocações antigas.
   * 
   * DELETE /api/v1/system/prune/metrics
   */
  async pruneMetrics({ request, response }: HttpContext) {
    const { before } = await request.validateUsing(pruneMetricsValidator)

    const deleted = await AllocationMetric.query()
      .where('createdAt', '<', before)
      .delete()

    return response.ok({
      message: 'Métricas removidas com sucesso.',
      deleted: deleted[0] ?? 0,
    })
  }
}
