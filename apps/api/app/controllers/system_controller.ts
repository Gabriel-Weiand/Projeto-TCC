import type { HttpContext } from '@adonisjs/core/http'
import Telemetry from '#models/telemetry'
import Allocation from '#models/allocation'
import Notification from '#models/notification'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import { DateTime } from 'luxon'
import {
  pruneAllocationsValidator,
  pruneNotificationsValidator,
  pruneSshAttemptsValidator,
} from '#validators/system'
import { labConfig } from '#services/lab_config'
import {
  pruneAllocations,
  pruneNotifications,
  pruneSshAttempts,
  runLabMaintenance,
} from '#services/lab_maintenance'

export default class SystemController {
  /**
   * Executa todas as tarefas de manutenção (mesmo fluxo do cron).
   *
   * POST /api/v1/system/maintenance/run
   */
  async runMaintenance({ response }: HttpContext) {
    const result = await runLabMaintenance()

    return response.ok({
      message: 'Manutenção executada com sucesso.',
      ...result,
    })
  }

  /**
   * Remove alocações terminais cuja endTime é anterior ao corte.
   * Telemetrias e métricas são removidas em CASCADE.
   *
   * DELETE /api/v1/system/prune/allocations
   */
  async pruneAllocations({ request, response }: HttpContext) {
    const payload = await request.validateUsing(pruneAllocationsValidator)

    const before = payload.before ? DateTime.fromJSDate(payload.before) : undefined

    const deleted = await pruneAllocations({
      before,
      status: payload.status,
      userId: payload.userId,
      machineId: payload.machineId,
    })

    return response.ok({
      message: 'Alocações removidas com sucesso.',
      deleted,
    })
  }

  /**
   * Remove notificações antigas (createdAt anterior ao corte).
   *
   * DELETE /api/v1/system/prune/notifications
   */
  async pruneNotifications({ request, response }: HttpContext) {
    const payload = await request.validateUsing(pruneNotificationsValidator)

    const before = payload.before ? DateTime.fromJSDate(payload.before) : undefined

    const deleted = await pruneNotifications({
      before,
      userId: payload.userId,
    })

    return response.ok({
      message: 'Notificações removidas com sucesso.',
      deleted,
    })
  }

  /**
   * Remove tentativas SSH mais antigas que o intervalo de retenção.
   *
   * DELETE /api/v1/system/prune/ssh-attempts
   */
  async pruneSshAttempts({ request, response }: HttpContext) {
    const payload = await request.validateUsing(pruneSshAttemptsValidator)

    const deleted = await pruneSshAttempts({
      keepDays: payload.keepDays,
      machineId: payload.machineId,
    })

    return response.ok({
      message: 'Tentativas SSH removidas com sucesso.',
      deleted,
      keepDays: payload.keepDays ?? labConfig.maintenance.pruneSshAttemptsDays,
    })
  }

  /**
   * Remove uma alocação (hard delete). Telemetrias e métricas em CASCADE.
   *
   * DELETE /api/v1/system/allocations/:id
   */
  async destroyAllocation({ params, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await allocation.delete()
    return response.noContent()
  }

  /**
   * Remove uma notificação específica.
   *
   * DELETE /api/v1/system/notifications/:id
   */
  async destroyNotification({ params, response }: HttpContext) {
    const notification = await Notification.findOrFail(params.id)
    await notification.delete()
    return response.noContent()
  }

  /**
   * Remove uma tentativa SSH específica.
   *
   * DELETE /api/v1/system/ssh-attempts/:id
   */
  async destroySshAttempt({ params, response }: HttpContext) {
    const attempt = await SshConnectionAttempt.findOrFail(params.id)
    await attempt.delete()
    return response.noContent()
  }

  /**
   * Remove uma telemetria específica.
   *
   * DELETE /api/v1/system/telemetries/:id
   */
  async destroyTelemetry({ params, response }: HttpContext) {
    const telemetry = await Telemetry.findOrFail(params.id)
    await telemetry.delete()
    return response.noContent()
  }

}
