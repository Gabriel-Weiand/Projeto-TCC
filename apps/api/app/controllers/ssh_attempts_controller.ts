import type { HttpContext } from '@adonisjs/core/http'
import { SshAttemptsService } from '#services/audit/ssh_attempts_service'

export default class SshAttemptsController {
  async index({ request, response }: HttpContext) {
    const { machineId, page = 1, limit = 50 } = request.qs()

    const attempts = await SshAttemptsService.listAttempts({
      machineId: machineId ? Number(machineId) : undefined,
      page: Number(page),
      limit: Number(limit),
    })

    return response.ok(attempts)
  }
}
