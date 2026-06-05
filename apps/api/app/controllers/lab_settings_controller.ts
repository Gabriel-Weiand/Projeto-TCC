import type { HttpContext } from '@adonisjs/core/http'
import {
  getLabRuntimeSettings,
  saveLabRuntimeSettings,
} from '#services/lab_runtime_settings'
import { updateLabSettingsValidator } from '#validators/lab_settings'

export default class LabSettingsController {
  /**
   * Flags operacionais alteráveis em runtime (sobrescrevem env até restart sem arquivo).
   *
   * GET /api/v1/lab/settings
   */
  async show({ response }: HttpContext) {
    return response.ok(getLabRuntimeSettings())
  }

  /**
   * Atualiza requireAdminApproval e/ou publicNames (storage/lab/runtime_settings.json).
   *
   * PUT /api/v1/lab/settings
   */
  async update({ request, response }: HttpContext) {
    const data = await request.validateUsing(updateLabSettingsValidator)

    if (data.requireAdminApproval === undefined && data.publicNames === undefined) {
      return response.badRequest({
        message: 'Informe requireAdminApproval e/ou publicNames.',
      })
    }

    saveLabRuntimeSettings(data)
    return response.ok(getLabRuntimeSettings())
  }
}
