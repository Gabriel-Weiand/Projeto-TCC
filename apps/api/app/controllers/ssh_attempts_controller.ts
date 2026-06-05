import type { HttpContext } from '@adonisjs/core/http'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import { pruneSshAttempts } from '#services/lab_maintenance'

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

  /**
   * Remove tentativas SSH mais antigas que o intervalo indicado.
   * O parâmetro :keepDays indica quantos dias manter (ex.: 4 = apaga tudo com mais de 4 dias).
   *
   * DELETE /api/v1/ssh-attempts/:keepDays
   */
  async destroy({ params, response }: HttpContext) {
    const keepDays = Number.parseInt(params.keepDays, 10)
    if (!Number.isFinite(keepDays) || keepDays <= 0) {
      return response.badRequest({
        message: 'O parâmetro keepDays deve ser um inteiro positivo (dias de retenção).',
      })
    }

    const deleted = await pruneSshAttempts({ keepDays })

    return response.ok({
      message: 'Tentativas SSH antigas removidas com sucesso.',
      deleted,
      keepDays,
    })
  }
}
