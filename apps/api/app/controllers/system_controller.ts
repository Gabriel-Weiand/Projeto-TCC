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
   * Remove telemetrias antigas.
   * 
   * DELETE /api/v1/system/prune/telemetries
   */
  async pruneTelemetries({ request, response }: HttpContext) {
    const { before, machineId } = await request.validateUsing(pruneTelemetriesValidator)

    let query = Telemetry.query().where('createdAt', '<', before)

    if (machineId) {
      query = query.where('machineId', machineId)
    }

    const deleted = await query.delete()

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
