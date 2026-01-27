import type { HttpContext } from '@adonisjs/core/http'
import Telemetry from '#models/telemetry'

export default class TelemetriesController {
  /**
   * Remove uma telemetria específica.
   * 
   * DELETE /api/v1/maintenance/telemetries/:telemetryId
   */
  async destroy({ params, response }: HttpContext) {
    const telemetry = await Telemetry.findOrFail(params.telemetryId)
    await telemetry.delete()

    return response.noContent()
  }
}
