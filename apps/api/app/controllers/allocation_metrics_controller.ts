import type { HttpContext } from '@adonisjs/core/http'
import AllocationMetric from '#models/allocation_metric'

export default class AllocationMetricsController {
  /**
   * Remove uma métrica de alocação específica.
   * * DELETE /api/v1/system/metrics/:id
   */
  async destroy({ params, response }: HttpContext) {
    // CORREÇÃO: params.id ao invés de params.metricId
    const metric = await AllocationMetric.findOrFail(params.id)
    await metric.delete()

    return response.noContent()
  }
}
