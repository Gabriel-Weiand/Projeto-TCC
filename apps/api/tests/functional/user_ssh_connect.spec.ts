import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

test.group('SSH connect — dados para o front', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET /allocations/my inclui máquina com IP e fingerprint para conectar', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'SSH User',
      email: 'ssh-connect@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-SSH',
      description: 'Lab',
      status: 'available',
      ipAddress: '10.0.0.42',
      hostFingerprint: 'SHA256:abcdef1234567890_ssh_host_fp',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ minutes: 5 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
    })

    const response = await client.get('/api/v1/allocations/my').loginAs(user)

    response.assertStatus(200)
    const row = response.body().data[0]
    assert.exists(row.machine)
    assert.equal(row.machine.ipAddress, '10.0.0.42')
    assert.equal(row.machine.hostFingerprint, 'SHA256:abcdef1234567890_ssh_host_fp')
  })

  test('GET /machines/:id expõe fingerprint para usuário autenticado', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'SSH Machine',
      email: 'ssh-machine@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-FP',
      description: 'Lab',
      status: 'available',
      hostFingerprint: 'SHA256:machine_detail_fp',
      ipAddress: '192.168.1.10',
    })

    const response = await client.get(`/api/v1/machines/${machine.id}`).loginAs(user)

    response.assertStatus(200)
    assert.equal(response.body().hostFingerprint, 'SHA256:machine_detail_fp')
    assert.equal(response.body().ipAddress, '192.168.1.10')
  })
})
