import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import Notification from '#models/notification'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { checkSshFailureFlood, notifyOfflineAgents } from '#services/notification/notification_service'

test.group('Admin notifications', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('flood SSH notifica admin após limiar na janela', async ({ assert }) => {
    const admin = await User.create({
      fullName: 'Admin Flood',
      email: 'admin-flood@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const machine = await Machine.create({
      name: 'PC-FLOOD',
      description: 'Lab',
      status: 'available',
    })

    const attempts = Array.from({ length: 20 }, (_, i) => ({
      machineId: machine.id,
      sourceIp: '10.0.0.1',
      targetUsername: `user${i}`,
      status: 'failed' as const,
      createdAt: DateTime.utc().minus({ minutes: 2 }),
    }))

    await SshConnectionAttempt.createMany(attempts)

    await checkSshFailureFlood(machine)

    const notifs = await Notification.query()
      .where('userId', admin.id)
      .where('title', 'Possível flood SSH')
    assert.lengthOf(notifs, 1)
    assert.include(notifs[0].message, 'PC-FLOOD')
    assert.include(notifs[0].message, `[machine#${machine.id}#]`)

    await checkSshFailureFlood(machine)

    const notifs2 = await Notification.query()
      .where('userId', admin.id)
      .where('title', 'Possível flood SSH')
    assert.lengthOf(notifs2, 1)
  })

  test('agente offline notifica admin para a máquina alvo', async ({ assert }) => {
    const admin = await User.create({
      fullName: 'Admin Off',
      email: 'admin-off@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const machine = await Machine.create({
      name: 'PC-OFF-UNIQUE',
      description: 'Lab',
      status: 'available',
      lastSeenAt: DateTime.utc().minus({ minutes: 30 }),
    })

    await notifyOfflineAgents()

    const notifs = await Notification.query()
      .where('userId', admin.id)
      .where('title', 'Agente offline')
      .where('message', 'like', `%[machine#${machine.id}#]%`)

    assert.lengthOf(notifs, 1)
    assert.include(notifs[0].message, 'PC-OFF-UNIQUE')

    await notifyOfflineAgents()

    const notifsAgain = await Notification.query()
      .where('userId', admin.id)
      .where('title', 'Agente offline')
      .where('message', 'like', `%[machine#${machine.id}#]%`)
    assert.lengthOf(notifsAgain, 1)
  })
})
