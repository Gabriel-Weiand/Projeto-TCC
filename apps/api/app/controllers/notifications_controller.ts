import type { HttpContext } from '@adonisjs/core/http'
import { markNotificationReadValidator } from '#validators/notification'
import { NotificationInboxService } from '#services/notification/inbox_service'
import { runWithDomainError } from '#controllers/shared/handle_domain_error'

export default class NotificationsController {
  /**
   * Lista as notificações do usuário logado.
   * GET /api/v1/notifications
   */
  async index({ auth, response }: HttpContext) {
    const notifications = await NotificationInboxService.listForUser(auth.user!.id)
    return response.ok(notifications)
  }

  /**
   * Marca uma notificação como lida ou não lida.
   * PATCH /api/v1/notifications/:id/read
   */
  async markAsRead({ auth, params, request, response }: HttpContext) {
    const { isRead } = await request.validateUsing(markNotificationReadValidator)

    return runWithDomainError(
      response,
      () =>
        NotificationInboxService.markRead(auth.user!, Number(params.id), isRead),
      (notification) => response.ok(notification)
    )
  }

  /**
   * Remove uma notificação do usuário logado.
   * DELETE /api/v1/notifications/:id
   */
  async destroy({ auth, params, response }: HttpContext) {
    return runWithDomainError(
      response,
      () => NotificationInboxService.deleteForUser(auth.user!, Number(params.id)),
      () => response.noContent()
    )
  }
}
