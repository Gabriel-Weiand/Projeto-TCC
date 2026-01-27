import type { HttpContext } from '@adonisjs/core/http'
import AllocationMetric from '#models/allocation_metric'

export default class AllocationMetricsController {
  /**
   * Remove uma métrica de alocação específica.
   * 
   * DELETE /api/v1/maintenance/metrics/:metricId
   */
  async destroy({ params, response }: HttpContext) {
    const metric = await AllocationMetric.findOrFail(params.metricId)
    await metric.delete()

    return response.noContent()
  }
}
