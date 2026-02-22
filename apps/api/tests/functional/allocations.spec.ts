import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

test.group('Allocations', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('usuário deve criar uma alocação', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-01',
      macAddress: 'AA:BB:CC:03:01:01',
      description: 'Computador do lab 1',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    const startTime = DateTime.now().plus({ hours: 1 })
    const endTime = DateTime.now().plus({ hours: 3 })

    // Act
    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: startTime.toISO(),
      endTime: endTime.toISO(),
    })

    // Assert
    response.assertStatus(201)
    response.assertBodyContains({
      machineId: machine.id,
      userId: user.id,
    })
  })

  test('NÃO deve criar alocação em máquina em manutenção', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-MANUTENCAO',
      macAddress: 'AA:BB:CC:03:01:02',
      description: 'Máquina em manutenção',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'maintenance',
    })

    const startTime = DateTime.now().plus({ hours: 1 })
    const endTime = DateTime.now().plus({ hours: 3 })

    // Act
    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: startTime.toISO(),
      endTime: endTime.toISO(),
    })

    // Assert
    response.assertStatus(400)
    response.assertBodyContains({
      code: 'MACHINE_IN_MAINTENANCE',
    })
  })

  test('NÃO deve criar alocação com conflito de horário', async ({ client, assert }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-01',
      macAddress: 'AA:BB:CC:03:01:03',
      description: 'Computador do lab 1',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    const startTime = DateTime.now().plus({ hours: 1 })
    const endTime = DateTime.now().plus({ hours: 3 })

    // Cria primeira alocação via API
    const firstResponse = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: startTime.toISO(),
      endTime: endTime.toISO(),
    })

    // Verifica se a primeira alocação foi criada com sucesso
    assert.equal(firstResponse.status(), 201, 'Primeira alocação deveria ser criada')

    // Act: tenta criar outra no mesmo horário (com sobreposição)
    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: startTime.plus({ minutes: 30 }).toISO(),
        endTime: endTime.plus({ minutes: 30 }).toISO(),
      })

    // Assert
    response.assertStatus(409)
    response.assertBodyContains({
      code: 'ALLOCATION_CONFLICT',
    })
  })

  test('usuário deve listar apenas suas próprias alocações', async ({ client, assert }) => {
    // Arrange
    const user1 = await User.create({
      fullName: 'User 1',
      email: 'user1@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const user2 = await User.create({
      fullName: 'User 2',
      email: 'user2@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-01',
      macAddress: 'AA:BB:CC:03:01:04',
      description: 'Computador do lab 1',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Alocações do user1
    await Allocation.create({
      userId: user1.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 2 }),
      status: 'pending',
    })

    // Alocações do user2
    await Allocation.create({
      userId: user2.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ hours: 3 }),
      endTime: DateTime.now().plus({ hours: 4 }),
      status: 'pending',
    })

    // Act: user1 lista suas alocações
    const response = await client.get('/api/v1/allocations').loginAs(user1)

    // Assert
    response.assertStatus(200)
    const body = response.body()
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0].userId, user1.id)
  })

  test('admin deve listar todas as alocações', async ({ client, assert }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user = await User.create({
      fullName: 'User Normal',
      email: 'user@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-01',
      macAddress: 'AA:BB:CC:03:01:05',
      description: 'Computador do lab 1',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    await Allocation.createMany([
      {
        userId: admin.id,
        machineId: machine.id,
        startTime: DateTime.now().plus({ hours: 1 }),
        endTime: DateTime.now().plus({ hours: 2 }),
        status: 'pending',
      },
      {
        userId: user.id,
        machineId: machine.id,
        startTime: DateTime.now().plus({ hours: 3 }),
        endTime: DateTime.now().plus({ hours: 4 }),
        status: 'pending',
      },
    ])

    // Act
    const response = await client.get('/api/v1/allocations').loginAs(admin)

    // Assert
    response.assertStatus(200)
    const body = response.body()
    assert.isAtLeast(body.data.length, 2)
  })

  test('admin deve atualizar status de uma alocação', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin User',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-01',
      macAddress: 'AA:BB:CC:03:01:06',
      description: 'Computador do lab 1',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 3 }),
      status: 'pending',
    })

    // Act: admin pode alterar qualquer status
    const response = await client.patch(`/api/v1/allocations/${allocation.id}`).loginAs(admin).json({
      status: 'approved',
    })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      status: 'approved',
    })
  })

  test('NÃO deve criar alocação sem autenticação', async ({ client }) => {
    // Act
    const response = await client.post('/api/v1/allocations').json({
      machineId: 1,
      startTime: DateTime.now().plus({ hours: 1 }).toISO(),
      endTime: DateTime.now().plus({ hours: 3 }).toISO(),
    })

    // Assert
    response.assertStatus(401)
  })
})
