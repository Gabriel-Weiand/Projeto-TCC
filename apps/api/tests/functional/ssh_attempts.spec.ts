import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('SSH Attempts', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('admin deve listar auditoria de SSH', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a@teste.com',
      password: '123',
      role: 'admin',
    })
    const machine = await Machine.create({ name: 'PC-1', description: 'Lab', status: 'available' })

    await SshConnectionAttempt.create({
      machineId: machine.id,
      sourceIp: '192.168.1.1',
      targetUsername: 'root',
      status: 'failed',
    })

    const response = await client.get('/api/v1/ssh-attempts').loginAs(admin)

    response.assertStatus(200)
    assert.equal(response.body().meta.total, 1)
  })

  test('utilizador comum é bloqueado na rota de auditoria', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u@teste.com',
      password: '123',
      role: 'user',
    })
    const response = await client.get('/api/v1/ssh-attempts').loginAs(user)

    response.assertStatus(403)
  })

  test('admin deve poder apagar um registo de tentativa', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin 2',
      email: 'a2@teste.com',
      password: '123',
      role: 'admin',
    })
    const machine = await Machine.create({ name: 'PC-2', description: 'Lab', status: 'available' })
    const attempt = await SshConnectionAttempt.create({
      machineId: machine.id,
      sourceIp: '10.0.0.1',
      targetUsername: 'admin',
      status: 'failed',
    })

    const response = await client.delete(`/api/v1/ssh-attempts/${attempt.id}`).loginAs(admin)

    response.assertStatus(204)
    const deleted = await SshConnectionAttempt.find(attempt.id)
    assert.isNull(deleted)
  })
})
