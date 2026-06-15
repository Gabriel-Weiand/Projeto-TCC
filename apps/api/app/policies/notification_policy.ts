import User from '#models/user'
import Notification from '#models/notification'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { denyWithCode } from '#policies/shared'

export default class NotificationPolicy extends BasePolicy {
  update(user: User, notification: Notification): AuthorizerResponse {
    return this.assertOwner(
      user,
      notification,
      'Você não tem permissão para alterar esta notificação.'
    )
  }

  delete(user: User, notification: Notification): AuthorizerResponse {
    return this.assertOwner(
      user,
      notification,
      'Você não tem permissão para excluir esta notificação.'
    )
  }

  private assertOwner(
    user: User,
    notification: Notification,
    message: string
  ): AuthorizerResponse {
    if (notification.userId === user.id) {
      return true
    }
    return denyWithCode('NOTIFICATION_FORBIDDEN', message)
  }
}
