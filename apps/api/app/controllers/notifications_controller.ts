import type { HttpContext } from '@adonisjs/core/http'
import Notification from '#models/notification'
import { markNotificationReadValidator } from '#validators/notification'
import { DateTime } from 'luxon'

export default class NotificationsController {
  /**
   * Lista as notificações do usuário logado.
   * GET /api/v1/notifications
   */
  async index({ auth, response }: HttpContext) {
    const user = auth.user!

    const notifications = await Notification.query()
      .where('userId', user.id)
      .orderBy('createdAt', 'desc')
      .limit(50) // Limite razoável para a caixa de entrada

    return response.ok(notifications)
  }

  /**
   * Marca uma notificação como lida ou não lida.
   * PATCH /api/v1/notifications/:id/read
   */
  async markAsRead({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const notification = await Notification.findOrFail(params.id)

    // Segurança: Garantir que o usuário só mexe nas próprias notificações
    if (notification.userId !== user.id) {
      return response.forbidden({
        message: 'Você não tem permissão para alterar esta notificação.',
      })
    }

    const { isRead } = await request.validateUsing(markNotificationReadValidator)

    notification.isRead = isRead
    notification.readAt = isRead ? DateTime.now() : null
    await notification.save()

    return response.ok(notification)
  }

  /**
   * Remove uma notificação do usuário logado.
   * DELETE /api/v1/notifications/:id
   */
  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const notification = await Notification.findOrFail(params.id)

    if (notification.userId !== user.id) {
      return response.forbidden({
        message: 'Você não tem permissão para excluir esta notificação.',
      })
    }

    await notification.delete()
    return response.noContent()
  }
}
