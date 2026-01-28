import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import testUtils from '@adonisjs/core/services/test_utils'

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
        description: 'Computador 1',
        cpuModel: 'Intel i5',
        totalRamGb: 8,
        totalDiskGb: 256,
        status: 'available',
      },
      {
        name: 'PC-02',
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
})
