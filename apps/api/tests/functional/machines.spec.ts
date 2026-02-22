import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

test.group('Machines', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('deve listar máquinas (usuário autenticado)', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    await Machine.createMany([
      {
        name: 'PC-01',
        macAddress: 'AA:BB:CC:01:01:01',
        description: 'Computador 1',
        cpuModel: 'Intel i5',
        totalRamGb: 8,
        totalDiskGb: 256,
        status: 'available',
      },
      {
        name: 'PC-02',
        macAddress: 'AA:BB:CC:01:01:02',
        description: 'Computador 2',
        cpuModel: 'Intel i7',
        totalRamGb: 16,
        totalDiskGb: 512,
        status: 'available',
      },
    ])

    // Act
    const response = await client.get('/api/v1/machines').loginAs(user)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains([{ name: 'PC-01' }, { name: 'PC-02' }])
  })

  test('admin deve criar uma nova máquina', async ({ client, assert }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    // Act
    const response = await client.post('/api/v1/machines').loginAs(admin).json({
      name: 'PC-LAB-NOVO',
      description: 'Nova máquina do lab',
      macAddress: 'AA:BB:CC:01:02:01',
      cpuModel: 'AMD Ryzen 7',
      gpuModel: 'NVIDIA RTX 4060',
      totalRamGb: 32,
      totalDiskGb: 1024,
    })

    // Assert
    response.assertStatus(201)
    response.assertBodyContains({
      name: 'PC-LAB-NOVO',
      cpuModel: 'AMD Ryzen 7',
    })

    // Verifica que o token foi retornado
    assert.exists(response.body().token)
  })

  test('usuário comum NÃO deve criar máquina', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'User Normal',
      email: 'user@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.post('/api/v1/machines').loginAs(user).json({
      name: 'PC-TENTATIVA',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
    })

    // Assert
    response.assertStatus(403)
  })

  test('admin deve visualizar detalhes de uma máquina', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-DETALHES',
      macAddress: 'AA:BB:CC:01:01:03',
      description: 'Máquina para teste de detalhes',
      cpuModel: 'Intel i9',
      gpuModel: 'RTX 4090',
      totalRamGb: 64,
      totalDiskGb: 2048,
      status: 'available',
    })

    // Act
    const response = await client.get(`/api/v1/machines/${machine.id}`).loginAs(admin)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      id: machine.id,
      name: 'PC-DETALHES',
      cpuModel: 'Intel i9',
    })
  })

  test('admin deve atualizar uma máquina', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-ATUALIZAR',
      macAddress: 'AA:BB:CC:01:01:04',
      description: 'Máquina para teste de atualização',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client.put(`/api/v1/machines/${machine.id}`).loginAs(admin).json({
      name: 'PC-ATUALIZADO',
      status: 'maintenance',
    })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      name: 'PC-ATUALIZADO',
      status: 'maintenance',
    })
  })

  test('admin deve deletar uma máquina', async ({ client, assert }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-DELETAR',
      macAddress: 'AA:BB:CC:01:01:05',
      description: 'Máquina para teste de exclusão',
      cpuModel: 'Intel i3',
      totalRamGb: 4,
      totalDiskGb: 128,
      status: 'available',
    })

    // Act
    const response = await client.delete(`/api/v1/machines/${machine.id}`).loginAs(admin)

    // Assert
    response.assertStatus(204)

    // Verifica que foi removida do banco
    const deleted = await Machine.find(machine.id)
    assert.isNull(deleted)
  })

  test('deve retornar 404 para máquina inexistente', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    // Act
    const response = await client.get('/api/v1/machines/99999').loginAs(admin)

    // Assert
    response.assertStatus(404)
  })

  test('admin deve visualizar token da máquina no GET', async ({ client, assert }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-COM-TOKEN',
      macAddress: 'AA:BB:CC:01:01:06',
      description: 'Máquina com token visível',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client.get(`/api/v1/machines/${machine.id}`).loginAs(admin)

    // Assert
    response.assertStatus(200)
    assert.exists(response.body().token)
    assert.equal(response.body().token, machine.token)
  })

  test('admin deve regenerar token da máquina', async ({ client, assert }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-REGENERAR-TOKEN',
      macAddress: 'AA:BB:CC:01:01:07',
      description: 'Máquina para regenerar token',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    const oldToken = machine.token

    // Act
    const response = await client
      .post(`/api/v1/machines/${machine.id}/regenerate-token`)
      .loginAs(admin)

    // Assert
    response.assertStatus(200)
    assert.exists(response.body().token)
    assert.notEqual(response.body().token, oldToken)
    assert.exists(response.body().tokenRotatedAt)

    // Verifica que o token foi alterado no banco
    await machine.refresh()
    assert.notEqual(machine.token, oldToken)
    assert.isNotNull(machine.tokenRotatedAt)
  })

  test('usuário comum NÃO deve regenerar token', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'User Normal',
      email: 'user@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-REGENERAR-TOKEN',
      macAddress: 'AA:BB:CC:01:01:08',
      description: 'Máquina para teste de permissão de token',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post(`/api/v1/machines/${machine.id}/regenerate-token`)
      .loginAs(user)

    // Assert
    response.assertStatus(403)
  })

  test('colocar máquina em manutenção deve cancelar alocações futuras', async ({
    client,
    assert,
  }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user = await User.create({
      fullName: 'User',
      email: 'user@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-MANUTENCAO',
      macAddress: 'AA:BB:CC:01:01:09',
      description: 'Máquina para teste de manutenção',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Cria alocações futuras
    const allocation1 = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ hours: 2 }),
      endTime: DateTime.now().plus({ hours: 4 }),
      status: 'approved',
    })

    const allocation2 = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ days: 1 }),
      endTime: DateTime.now().plus({ days: 1, hours: 2 }),
      status: 'approved',
    })

    // Act
    const response = await client.put(`/api/v1/machines/${machine.id}`).loginAs(admin).json({
      status: 'maintenance',
    })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      status: 'maintenance',
    })

    // Verifica que alocações foram canceladas
    await allocation1.refresh()
    await allocation2.refresh()
    assert.equal(allocation1.status, 'cancelled')
    assert.equal(allocation2.status, 'cancelled')
  })
})
