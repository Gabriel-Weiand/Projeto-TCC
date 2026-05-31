import type { HttpContext } from '@adonisjs/core/http'
import Telemetry from '#models/telemetry'

export default class TelemetriesController {
  /**
   * Remove uma telemetria específica.
   * * DELETE /api/v1/system/telemetries/:id
   */
  async destroy({ params, response }: HttpContext) {
    // CORREÇÃO: params.id ao invés de params.telemetryId
    const telemetry = await Telemetry.findOrFail(params.id)
    await telemetry.delete()

    return response.noContent()
  }
}
