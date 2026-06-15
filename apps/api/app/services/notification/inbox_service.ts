import { DateTime } from 'luxon'
import Notification from '#models/notification'
import User from '#models/user'
import { DomainError } from '#services/shared/domain_error'

const INBOX_LIMIT = 50

function assertOwnership(notification: Notification, userId: number) {
  if (notification.userId !== userId) {
    throw new DomainError(
      'NOTIFICATION_FORBIDDEN',
      'Você não tem permissão para alterar esta notificação.',
      403
    )
  }
}

export const NotificationInboxService = {
  async listForUser(userId: number) {
    return Notification.query()
      .where('userId', userId)
      .orderBy('createdAt', 'desc')
      .limit(INBOX_LIMIT)
  },

  async markRead(user: User, notificationId: number, isRead: boolean) {
    const notification = await Notification.findOrFail(notificationId)
    assertOwnership(notification, user.id)

    notification.isRead = isRead
    notification.readAt = isRead ? DateTime.now() : null
    await notification.save()
    return notification
  },

  async deleteForUser(user: User, notificationId: number) {
    const notification = await Notification.findOrFail(notificationId)

    if (notification.userId !== user.id) {
      throw new DomainError(
        'NOTIFICATION_FORBIDDEN',
        'Você não tem permissão para excluir esta notificação.',
        403
      )
    }

    await notification.delete()
  },
}
