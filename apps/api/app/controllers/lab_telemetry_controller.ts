import type { HttpContext } from '@adonisjs/core/http'
import {
  getLabTelemetryPresets,
  normalizeLabTelemetryPresets,
  saveLabTelemetryPresets,
  type LabTelemetryPresets,
} from '#services/telemetry_presets'
import { updateLabTelemetryPresetsValidator } from '#validators/lab_telemetry'

export default class LabTelemetryController {
  /**
   * Perfis fast/eco do laboratório (valem para todas as máquinas com esse preset).
   *
   * GET /api/v1/lab/telemetry-presets
   */
  async show({ response }: HttpContext) {
    return response.ok(getLabTelemetryPresets())
  }

  /**
   * Atualiza perfis globais fast/eco (persistidos em storage/lab/telemetry_presets.json).
   *
   * PUT /api/v1/lab/telemetry-presets
   */
  async update({ request, response }: HttpContext) {
    const data = normalizeLabTelemetryPresets(
      (await request.validateUsing(updateLabTelemetryPresetsValidator)) as LabTelemetryPresets
    )
    saveLabTelemetryPresets(data)
    return response.ok(getLabTelemetryPresets())
  }
}
