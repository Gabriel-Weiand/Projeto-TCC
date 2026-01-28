import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

test.group('Agent API', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('heartbeat deve manter máquina online', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-01',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'offline',
    })

    // Act
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      machine: {
        id: machine.id,
        name: 'PC-AGENT-01',
      },
      shouldBlock: false,
    })

    // Verifica que status mudou para available
    await machine.refresh()
    assert.equal(machine.status, 'available')
    assert.isNotNull(machine.lastSeenAt)
  })

  test('heartbeat deve retornar alocação atual se existir', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-02',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Cria alocação ativa (agora)
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
    })

    // Act
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      currentAllocation: {
        userId: user.id,
        userEmail: 'teste@teste.com',
      },
    })
  })

  test('validate-user deve autorizar usuário com alocação ativa', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-03',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Cria alocação ativa
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
    })

    // Act
    const response = await client
      .post('/api/agent/validate-user')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        email: 'teste@teste.com',
        password: 'senha123',
      })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      allowed: true,
      reason: 'AUTHORIZED',
      user: {
        id: user.id,
        email: 'teste@teste.com',
      },
    })
  })

  test('validate-user deve negar usuário sem alocação ativa', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-04',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Não cria alocação

    // Act
    const response = await client
      .post('/api/agent/validate-user')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        email: 'teste@teste.com',
        password: 'senha123',
      })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      allowed: false,
      reason: 'NO_ACTIVE_ALLOCATION',
    })
  })

  test('validate-user deve rejeitar credenciais inválidas', async ({ client }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-05',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post('/api/agent/validate-user')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        email: 'naoexiste@teste.com',
        password: 'senhaqualquer',
      })

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      allowed: false,
      reason: 'INVALID_CREDENTIALS',
    })
  })

  test('validate-user deve negar acesso em máquina em manutenção', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-MANUTENCAO',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'maintenance',
    })

    // Act
    const response = await client
      .post('/api/agent/validate-user')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        email: 'teste@teste.com',
        password: 'senha123',
      })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      allowed: false,
      reason: 'MACHINE_MAINTENANCE',
    })
  })

  test('allocations deve listar alocações da máquina', async ({ client, assert }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-06',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Cria alocações futuras
    await Allocation.createMany([
      {
        userId: user.id,
        machineId: machine.id,
        startTime: DateTime.now().plus({ hours: 1 }),
        endTime: DateTime.now().plus({ hours: 2 }),
        status: 'approved',
      },
      {
        userId: user.id,
        machineId: machine.id,
        startTime: DateTime.now().plus({ hours: 3 }),
        endTime: DateTime.now().plus({ hours: 4 }),
        status: 'approved',
      },
    ])

    // Act
    const response = await client
      .get('/api/agent/allocations')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    assert.equal(response.body().allocations.length, 2)
    assert.equal(response.body().machineId, machine.id)
  })

  test('current-session deve retornar sessão ativa', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-07',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Cria alocação ativa
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
    })

    // Act
    const response = await client
      .get('/api/agent/current-session')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      hasActiveSession: true,
      session: {
        allocationId: allocation.id,
        user: {
          id: user.id,
          email: 'teste@teste.com',
        },
      },
    })
  })

  test('current-session deve retornar null quando não há sessão', async ({ client }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-08',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .get('/api/agent/current-session')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      hasActiveSession: false,
      session: null,
    })
  })

  test('should-block deve retornar true para máquina em manutenção', async ({ client }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-MANUTENCAO',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'maintenance',
    })

    // Act
    const response = await client
      .get('/api/agent/should-block')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      shouldBlock: true,
      reason: 'MACHINE_MAINTENANCE',
    })
  })

  test('should-block deve retornar true quando alocação expirou', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-09',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Não cria alocação ativa para o usuário

    // Act
    const response = await client
      .get(`/api/agent/should-block?loggedUserId=${user.id}`)
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      shouldBlock: true,
      reason: 'ALLOCATION_EXPIRED_OR_REVOKED',
    })
  })

  test('report-login deve registrar usuário logado', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-10',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post('/api/agent/report-login')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        username: 'aluno.silva',
      })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      registered: true,
    })

    await machine.refresh()
    assert.equal(machine.loggedUser, 'aluno.silva')
    assert.equal(machine.status, 'occupied')
  })

  test('report-logout deve limpar usuário logado', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-11',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'occupied',
      loggedUser: 'aluno.silva',
    })

    // Act
    const response = await client
      .post('/api/agent/report-logout')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      registered: true,
    })

    await machine.refresh()
    assert.isNull(machine.loggedUser)
    assert.equal(machine.status, 'available')
  })

  test('sync-specs deve atualizar especificações da máquina', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-12',
      status: 'available',
    })

    // Act
    const response = await client
      .put('/api/agent/sync-specs')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        cpuModel: 'AMD Ryzen 9 5900X',
        gpuModel: 'NVIDIA RTX 4080',
        totalRamGb: 64,
        totalDiskGb: 2048,
        ipAddress: '192.168.1.100',
        macAddress: 'AA:BB:CC:DD:EE:FF',
      })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      synced: true,
      machine: {
        cpuModel: 'AMD Ryzen 9 5900X',
        gpuModel: 'NVIDIA RTX 4080',
        totalRamGb: 64,
      },
    })

    await machine.refresh()
    assert.equal(machine.cpuModel, 'AMD Ryzen 9 5900X')
    assert.equal(machine.totalRamGb, 64)
  })

  test('telemetry deve aceitar dados de telemetria', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-13',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'offline',
    })

    // Act
    const response = await client
      .post('/api/agent/telemetry')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        cpuUsage: 450,
        cpuTemp: 650,
        gpuUsage: 200,
        gpuTemp: 550,
        ramUsage: 600,
        diskUsage: 300,
        downloadUsage: 50.5,
        uploadUsage: 10.2,
      })

    // Assert
    response.assertStatus(204)

    await machine.refresh()
    assert.equal(machine.status, 'available')
    assert.isNotNull(machine.lastSeenAt)
  })

  test('deve rejeitar requisição sem token', async ({ client }) => {
    // Act
    const response = await client.post('/api/agent/heartbeat')

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      code: 'MISSING_HEADER',
    })
  })

  test('deve rejeitar requisição com token inválido', async ({ client }) => {
    // Act
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', 'Bearer token_invalido_123')

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      code: 'INVALID_TOKEN',
    })
  })
})
