import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import Notification from '#models/notification'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

test.group('System Maintenance', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('utilizador comum é bloqueado em rotas de sistema', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u@teste.com',
      password: '123',
      role: 'user',
    })
    const response = await client
      .delete('/api/v1/system/prune/notifications')
      .loginAs(user)
      .json({ before: new Date().toISOString() })
    response.assertStatus(403)
  })

  test('admin deve fazer prune de notificações antigas', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin 3',
      email: 'a3@teste.com',
      password: '123',
      role: 'admin',
    })

    const antiga = await Notification.create({
      userId: admin.id,
      title: 'Antiga',
      message: 'Msg antiga',
      isRead: true,
    })
    await antiga.merge({ createdAt: DateTime.now().minus({ days: 60 }) }).save()

    const recente = await Notification.create({
      userId: admin.id,
      title: 'Recente',
      message: 'Msg recente',
      isRead: false,
    })

    const response = await client
      .delete('/api/v1/system/prune/notifications')
      .loginAs(admin)
      .json({ before: DateTime.now().minus({ days: 30 }).toISO() })

    response.assertStatus(200)
    assert.isAtLeast(response.body().deleted, 1)
    assert.isNull(await Notification.find(antiga.id))
    assert.isNotNull(await Notification.find(recente.id))
  })

  test('admin pode executar manutenção completa manualmente', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin 4',
      email: 'a4@teste.com',
      password: '123',
      role: 'admin',
    })

    const response = await client.post('/api/v1/system/maintenance/run').loginAs(admin)

    response.assertStatus(200)
    const body = response.body()
    assert.equal(body.message, 'Manutenção executada com sucesso.')
    for (const key of ['tokens', 'summarized', 'allocations', 'notifications', 'sshAttempts']) {
      assert.isNumber(body[key])
      assert.isAtLeast(body[key], 0)
    }
  })

  test('admin deve deletar alocação individual (hard delete)', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin 5',
      email: 'a5@teste.com',
      password: '123',
      role: 'admin',
    })
    const machine = await Machine.create({ name: 'PC-5', description: 'Lab', status: 'available' })

    const allocation = await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 2 }),
      endTime: DateTime.utc().minus({ hours: 1 }),
      status: 'finished',
    })

    const response = await client
      .delete(`/api/v1/system/allocations/${allocation.id}`)
      .loginAs(admin)

    response.assertStatus(204)
    assert.isNull(await Allocation.find(allocation.id))
  })
})
