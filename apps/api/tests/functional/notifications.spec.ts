import { test } from '@japa/runner'
import User from '#models/user'
import Notification from '#models/notification'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Notifications', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('utilizador deve listar apenas as suas próprias notificações', async ({
    client,
    assert,
  }) => {
    const user1 = await User.create({
      fullName: 'User 1',
      email: 'u1@teste.com',
      password: '123',
      role: 'user',
    })
    const user2 = await User.create({
      fullName: 'User 2',
      email: 'u2@teste.com',
      password: '123',
      role: 'user',
    })

    await Notification.create({
      userId: user1.id,
      title: 'Aviso 1',
      message: 'Para user 1',
      isRead: false,
    })
    await Notification.create({
      userId: user2.id,
      title: 'Aviso 2',
      message: 'Para user 2',
      isRead: false,
    })

    const response = await client.get('/api/v1/notifications').loginAs(user1)

    response.assertStatus(200)
    assert.equal(response.body().length, 1)
    assert.equal(response.body()[0].title, 'Aviso 1')
  })

  test('utilizador deve conseguir marcar notificação como lida', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u@teste.com',
      password: '123',
      role: 'user',
    })
    const notif = await Notification.create({
      userId: user.id,
      title: 'Aviso',
      message: 'Msg',
      isRead: false,
    })

    const response = await client
      .patch(`/api/v1/notifications/${notif.id}/read`)
      .loginAs(user)
      .json({
        isRead: true,
      })

    response.assertStatus(200)
    await notif.refresh()
    assert.isTrue(notif.isRead)
    assert.isNotNull(notif.readAt)
  })

  test('utilizador NÃO pode alterar notificação de terceiros', async ({ client }) => {
    const user1 = await User.create({
      fullName: 'User 1',
      email: 'u11@teste.com',
      password: '123',
      role: 'user',
    })
    const user2 = await User.create({
      fullName: 'User 2',
      email: 'u22@teste.com',
      password: '123',
      role: 'user',
    })
    const notif = await Notification.create({
      userId: user2.id,
      title: 'Aviso',
      message: 'Msg',
      isRead: false,
    })

    const response = await client
      .patch(`/api/v1/notifications/${notif.id}/read`)
      .loginAs(user1)
      .json({
        isRead: true,
      })

    response.assertStatus(403)
  })

  test('utilizador deve conseguir excluir a própria notificação', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u.del@teste.com',
      password: '123',
      role: 'user',
    })
    const notif = await Notification.create({
      userId: user.id,
      title: 'Aviso',
      message: 'Msg',
      isRead: false,
    })

    const response = await client
      .delete(`/api/v1/notifications/${notif.id}`)
      .loginAs(user)

    response.assertStatus(204)
    assert.isNull(await Notification.find(notif.id))
  })

  test('utilizador NÃO pode excluir notificação de terceiros', async ({ client }) => {
    const user1 = await User.create({
      fullName: 'User 1',
      email: 'u.del1@teste.com',
      password: '123',
      role: 'user',
    })
    const user2 = await User.create({
      fullName: 'User 2',
      email: 'u.del2@teste.com',
      password: '123',
      role: 'user',
    })
    const notif = await Notification.create({
      userId: user2.id,
      title: 'Aviso',
      message: 'Msg',
      isRead: false,
    })

    const response = await client
      .delete(`/api/v1/notifications/${notif.id}`)
      .loginAs(user1)

    response.assertStatus(403)
  })
})
