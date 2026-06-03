import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import Notification from '#models/notification'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { runScheduledAllocationReminders } from '#services/notification_service'

test.group('Allocation notifications', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('criação aprovada automática NÃO notifica o usuário', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Aluno Notif',
      email: 'notif-create@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-NOTIF',
      description: 'Lab',
      status: 'available',
    })

    const start = DateTime.utc().plus({ hours: 2 }).toISO()
    const end = DateTime.utc().plus({ hours: 4 }).toISO()

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: start,
      endTime: end,
    })

    response.assertStatus(201)

    const notifications = await Notification.query().where('userId', user.id)
    assert.lengthOf(notifications, 0)
  })

  test('criação pending notifica admins quando exige aprovação', async ({ client, assert }) => {
    const prev = process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL
    process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL = 'true'

    const admin = await User.create({
      fullName: 'Admin Pend',
      email: 'admin-pend@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'Aluno Pend',
      email: 'notif-pend@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-PEND-NOTIF',
      description: 'Lab',
      status: 'available',
    })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 2 }).toISO(),
      endTime: DateTime.utc().plus({ hours: 4 }).toISO(),
    })

    if (prev !== undefined) process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL = prev
    else delete process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL

    response.assertStatus(201)
    response.assertBodyContains({ status: 'pending' })

    const adminNotifs = await Notification.query().where('userId', admin.id)
    assert.lengthOf(adminNotifs, 1)
    assert.equal(adminNotifs[0].title, 'Nova reserva pendente')
  })

  test('aprovação de pending notifica o usuário', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Apr',
      email: 'admin-apr@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'Aluno Apr',
      email: 'notif-apr@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-APR',
      description: 'Lab',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 3 }),
      status: 'pending',
    })

    const response = await client
      .patch(`/api/v1/allocations/${allocation.id}`)
      .loginAs(admin)
      .json({ status: 'approved' })

    response.assertStatus(200)

    const notifications = await Notification.query().where('userId', user.id)
    assert.lengthOf(notifications, 1)
    assert.equal(notifications[0].title, 'Reserva aprovada')
  })

  test('negação de reserva notifica o usuário', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Neg',
      email: 'admin-neg@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'Aluno Neg',
      email: 'notif-deny@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-DENY',
      description: 'Lab',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 3 }),
      status: 'pending',
    })

    const response = await client
      .patch(`/api/v1/allocations/${allocation.id}`)
      .loginAs(admin)
      .json({ status: 'denied' })

    response.assertStatus(200)

    const userNotifs = await Notification.query().where('userId', user.id)
    assert.lengthOf(userNotifs, 1)
    assert.equal(userNotifs[0].title, 'Reserva negada')
  })

  test('cancelamento notifica o usuário', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Aluno Canc',
      email: 'notif-canc@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-CANC',
      description: 'Lab',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 2 }),
      endTime: DateTime.utc().plus({ hours: 4 }),
      status: 'approved',
    })

    const response = await client
      .patch(`/api/v1/allocations/${allocation.id}`)
      .loginAs(user)
      .json({ status: 'cancelled' })

    response.assertStatus(200)

    const notifications = await Notification.query().where('userId', user.id)
    assert.lengthOf(notifications, 1)
    assert.equal(notifications[0].title, 'Reserva cancelada')
  })

  test('manutenção cancela todas as reservas e notifica (manutenção)', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Maint',
      email: 'admin-maint@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'Aluno Maint',
      email: 'notif-maint@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-MAINT',
      description: 'Lab',
      status: 'available',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 2 }),
      endTime: DateTime.utc().plus({ hours: 4 }),
      status: 'approved',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ minutes: 30 }),
      endTime: DateTime.utc().plus({ hours: 1 }),
      status: 'approved',
    })

    const response = await client.put(`/api/v1/machines/${machine.id}`).loginAs(admin).json({
      status: 'maintenance',
    })

    response.assertStatus(200)
    assert.equal(response.body().cancelledAllocations, 2)

    const notifications = await Notification.query().where('userId', user.id)
    assert.lengthOf(notifications, 2)
    assert.isTrue(
      notifications.every((n) => n.title === 'Reserva cancelada (manutenção)')
    )
  })

  test('scheduler T-10 avisa reserva em breve', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Aluno Breve',
      email: 'notif-breve@teste.com',
      password: 'senha123',
      role: 'user',
      sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHRlc3Q=',
    })
    const machine = await Machine.create({
      name: 'PC-BREVE',
      description: 'Lab',
      status: 'available',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ minutes: 8 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
    })

    const result = await runScheduledAllocationReminders()
    assert.equal(result.upcoming, 1)

    const notifications = await Notification.query().where('userId', user.id)
    assert.equal(notifications[0].title, 'Reserva em breve')

    const again = await runScheduledAllocationReminders()
    assert.equal(again.upcoming, 0)
  })

  test('scheduler T-5 avisa chave SSH se usuário não cadastrou', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Sem Chave',
      email: 'notif-sem-chave@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-SSH',
      description: 'Lab',
      status: 'available',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ minutes: 3 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
    })

    const result = await runScheduledAllocationReminders()
    assert.equal(result.sshT5, 1)
    assert.equal(result.upcoming, 1)

    const notifications = await Notification.query().where('userId', user.id)
    const sshNotif = notifications.find((n) => n.title === 'Chave SSH — reserva em 5 min')
    assert.isDefined(sshNotif)
    assert.include(sshNotif!.message, 'PC-SSH')
  })

  test('T-5 não notifica chave se usuário já cadastrou', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Com Chave',
      email: 'notif-com-chave@teste.com',
      password: 'senha123',
      role: 'user',
      sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHRlc3Q=',
    })
    const machine = await Machine.create({
      name: 'PC-SSH2',
      description: 'Lab',
      status: 'available',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ minutes: 3 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
    })

    const result = await runScheduledAllocationReminders()
    assert.equal(result.sshT5, 0)
  })
})
