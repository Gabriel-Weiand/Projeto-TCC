import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
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
      .delete('/api/v1/system/prune/allocations')
      .loginAs(user)
      .json({ before: new Date().toISOString() })
    response.assertStatus(403)
  })

  test('admin deve fazer prune de alocações antigas', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a@teste.com',
      password: '123',
      role: 'admin',
    })
    const machine = await Machine.create({ name: 'PC-1', description: 'Lab', status: 'available' })

    // Cria alocação antiga (acabou há 1 mês) e finalizada
    await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ months: 1, hours: 2 }),
      endTime: DateTime.utc().minus({ months: 1 }),
      status: 'finished',
    })

    // Cria alocação recente
    const recente = await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 1 }),
      status: 'approved',
    })

    const limite = DateTime.utc().minus({ days: 15 }).toISO()

    const response = await client.delete('/api/v1/system/prune/allocations').loginAs(admin).json({
      before: limite,
    })

    response.assertStatus(200)
    response.assertBodyContains({ deleted: 1 }) // Apenas a antiga foi apagada

    const exists = await Allocation.find(recente.id)
    assert.isNotNull(exists) // A recente continua lá
  })
})
