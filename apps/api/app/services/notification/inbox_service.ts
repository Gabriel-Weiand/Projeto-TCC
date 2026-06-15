import { DateTime } from 'luxon'
import Notification from '#models/notification'

const INBOX_LIMIT = 50

export const NotificationInboxService = {
  async listForUser(userId: number) {
    return Notification.query()
      .where('userId', userId)
      .orderBy('createdAt', 'desc')
      .limit(INBOX_LIMIT)
  },

  async markRead(notification: Notification, isRead: boolean) {
    notification.isRead = isRead
    notification.readAt = isRead ? DateTime.now() : null
    await notification.save()
    return notification
  },

  async deleteNotification(notification: Notification) {
    await notification.delete()
  },
}
