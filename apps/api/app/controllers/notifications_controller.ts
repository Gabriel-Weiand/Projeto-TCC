import type { HttpContext } from '@adonisjs/core/http'
import Notification from '#models/notification'
import NotificationPolicy from '#policies/notification_policy'
import { markNotificationReadValidator } from '#validators/notification'
import { NotificationInboxService } from '#services/notification/inbox_service'

export default class NotificationsController {
  async index({ auth, response }: HttpContext) {
    const notifications = await NotificationInboxService.listForUser(auth.user!.id)
    return response.ok(notifications)
  }

  async markAsRead({ params, request, response, bouncer }: HttpContext) {
    const notification = await Notification.findOrFail(params.id)
    await bouncer.with(NotificationPolicy).authorize('update', notification)

    const { isRead } = await request.validateUsing(markNotificationReadValidator)
    const updated = await NotificationInboxService.markRead(notification, isRead)
    return response.ok(updated)
  }

  async destroy({ params, response, bouncer }: HttpContext) {
    const notification = await Notification.findOrFail(params.id)
    await bouncer.with(NotificationPolicy).authorize('delete', notification)

    await NotificationInboxService.deleteNotification(notification)
    return response.noContent()
  }
}
