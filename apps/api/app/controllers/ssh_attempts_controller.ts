// app/controllers/ssh_attempts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import SshConnectionAttempt from '#models/ssh_connection_attempt'

export default class SshAttemptsController {
  async index({ request, response }: HttpContext) {
    const { machineId, page = 1, limit = 50 } = request.qs()

    let query = SshConnectionAttempt.query().preload('machine').orderBy('createdAt', 'desc')

    if (machineId) {
      query = query.where('machineId', machineId)
    }

    const attempts = await query.paginate(page, limit)
    return response.ok(attempts)
  }

  async destroy({ params, response }: HttpContext) {
    const attempt = await SshConnectionAttempt.findOrFail(params.id)
    await attempt.delete()
    return response.noContent()
  }
}
