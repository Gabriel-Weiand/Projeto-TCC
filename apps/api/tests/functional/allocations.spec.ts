import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

test.group('Allocations', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // =========================================================================
  // CRIAÇÃO E REGRAS DE NEGÓCIO (store)
  // =========================================================================

  test('usuário deve criar uma alocação comum (sem sudo) e auto-aprovar', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', status: 'available' })

    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: DateTime.utc().plus({ hours: 1 }).toISO(), // Tudo em UTC no teste
        endTime: DateTime.utc().plus({ hours: 3 }).toISO(),
        isSudo: false,
      })

    response.assertStatus(201)
    response.assertBodyContains({ status: 'approved', isSudo: false })
  })

  test('alocação com privilégios (sudo) deve ficar pendente de aprovação', async ({ client }) => {
    const user = await User.create({
      fullName: 'Sudo User',
      email: 'sudo@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({ name: 'PC-02', description: 'Lab', status: 'available' })

    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: DateTime.utc().plus({ hours: 1 }).toISO(),
        endTime: DateTime.utc().plus({ hours: 3 }).toISO(),
        isSudo: true,
      })

    response.assertStatus(201)
    response.assertBodyContains({ status: 'pending', isSudo: true })
  })

  test('NÃO deve criar alocação em máquina em manutenção', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u1@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-MANU',
      description: 'Manutenção',
      status: 'maintenance',
    })

    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: DateTime.utc().plus({ hours: 1 }).toISO(),
        endTime: DateTime.utc().plus({ hours: 2 }).toISO(),
      })

    response.assertStatus(400)
    response.assertBodyContains({ code: 'MACHINE_IN_MAINTENANCE' })
  })

  test('NÃO deve criar alocação com conflito de horário na mesma máquina', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u2@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', status: 'available' })

    const baseStart = DateTime.utc().plus({ hours: 1 })
    const baseEnd = DateTime.utc().plus({ hours: 3 })

    // Cria a primeira reserva (1h às 3h)
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: baseStart,
      endTime: baseEnd,
      status: 'approved',
    })

    // Tenta criar sobreposta (1.5h às 3.5h)
    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: baseStart.plus({ minutes: 30 }).toISO(),
        endTime: baseEnd.plus({ minutes: 30 }).toISO(),
      })

    response.assertStatus(409)
    response.assertBodyContains({ code: 'ALLOCATION_CONFLICT' })
  })

  // =========================================================================
  // LISTAGENS (index e myAllocations)
  // =========================================================================

  test('usuário deve listar apenas suas próprias alocações', async ({ client, assert }) => {
    const user1 = await User.create({
      fullName: 'User 1',
      email: 'a1@teste.com',
      password: '123',
      role: 'user',
    })
    const user2 = await User.create({
      fullName: 'User 2',
      email: 'a2@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', status: 'available' })

    await Allocation.create({
      userId: user1.id,
      machineId: machine.id,
      startTime: DateTime.utc(),
      endTime: DateTime.utc().plus({ hours: 1 }),
    })
    await Allocation.create({
      userId: user2.id,
      machineId: machine.id,
      startTime: DateTime.utc(),
      endTime: DateTime.utc().plus({ hours: 1 }),
    })

    const response = await client.get('/api/v1/allocations/my').loginAs(user1)

    response.assertStatus(200)
    assert.equal(response.body().meta.total, 1)
  })

  // =========================================================================
  // EXTENSÃO (Grace Period)
  // =========================================================================

  test('usuário deve conseguir estender a sua própria alocação ativa', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Ext User',
      email: 'ext@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', status: 'available' })

    const endTime = DateTime.utc().plus({ minutes: 30 }) // Acaba daqui a 30 mins

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ minutes: 30 }),
      endTime: endTime,
      status: 'approved',
    })

    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/extend`)
      .loginAs(user)
      .json({
        additionalMinutes: 30,
      })

    response.assertStatus(200)
    await allocation.refresh()

    // O novo endTime deve ser 30 minutos maior
    const diffMins = allocation.endTime.diff(endTime, 'minutes').minutes
    assert.closeTo(diffMins, 30, 1)
  })

  test('deve negar extensão se a alocação já tiver passado do grace period', async ({ client }) => {
    const user = await User.create({
      fullName: 'Teste',
      email: 't2@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', status: 'available' })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 2 }),
      endTime: DateTime.utc().minus({ minutes: 10 }), // Acabou há 10 minutos (fora dos 5 min de tolerância)
      status: 'approved',
    })

    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/extend`)
      .loginAs(user)
      .json({
        additionalMinutes: 30,
      })

    response.assertStatus(400)
    response.assertBodyContains({
      message: 'O tempo limite para extensão expirou (Grace Period encerrado).',
    })
  })

  // =========================================================================
  // SEGURANÇA BÁSICA
  // =========================================================================

  test('NÃO deve criar alocação sem autenticação', async ({ client }) => {
    const response = await client.post('/api/v1/allocations').json({
      machineId: 1,
      startTime: DateTime.utc().toISO(),
      endTime: DateTime.utc().plus({ hours: 1 }).toISO(),
    })
    response.assertStatus(401)
  })
})
