import type { HttpContext } from '@adonisjs/core/http'
import {
  pruneNotificationsValidator,
  pruneSshAttemptsValidator,
} from '#validators/system'
import { SystemService } from '#services/system/system_service'

export default class SystemController {
  /**
   * Executa todas as tarefas de manutenção (mesmo fluxo do cron).
   *
   * POST /api/v1/system/maintenance/run
   */
  async runMaintenance({ response }: HttpContext) {
    const result = await SystemService.runMaintenance()
    return response.ok(result)
  }

  /**
   * Remove notificações antigas (createdAt anterior ao corte).
   *
   * DELETE /api/v1/system/prune/notifications
   */
  async pruneNotifications({ request, response }: HttpContext) {
    const payload = await request.validateUsing(pruneNotificationsValidator)
    const result = await SystemService.pruneNotifications(payload)
    return response.ok(result)
  }

  /**
   * Remove tentativas SSH mais antigas que o intervalo de retenção.
   *
   * DELETE /api/v1/system/prune/ssh-attempts
   */
  async pruneSshAttempts({ request, response }: HttpContext) {
    const payload = await request.validateUsing(pruneSshAttemptsValidator)
    const result = await SystemService.pruneSshAttempts(payload)
    return response.ok(result)
  }

  /**
   * Remove uma alocação (hard delete). Telemetrias e métricas em CASCADE.
   *
   * DELETE /api/v1/system/allocations/:id
   */
  async destroyAllocation({ params, response }: HttpContext) {
    await SystemService.hardDeleteAllocation(Number(params.id))
    return response.noContent()
  }

  /**
   * Remove uma tentativa SSH específica.
   *
   * DELETE /api/v1/system/ssh-attempts/:id
   */
  async destroySshAttempt({ params, response }: HttpContext) {
    await SystemService.hardDeleteSshAttempt(Number(params.id))
    return response.noContent()
  }
}
