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
      macAddress: 'AA:BB:CC:02:01:01',
      description: 'Agente teste heartbeat',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'offline',
    })

    // Act
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)

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
      macAddress: 'AA:BB:CC:02:01:02',
      description: 'Agente teste heartbeat com alocação',
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
      .header('X-Machine-Mac', machine.macAddress)

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
      macAddress: 'AA:BB:CC:02:01:03',
      description: 'Agente teste validate-user autorizado',
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
      .header('X-Machine-Mac', machine.macAddress)
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
    await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-04',
      macAddress: 'AA:BB:CC:02:01:04',
      description: 'Agente teste validate-user negado',
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
      .header('X-Machine-Mac', machine.macAddress)
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
      macAddress: 'AA:BB:CC:02:01:05',
      description: 'Agente teste credenciais inválidas',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post('/api/agent/validate-user')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
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
    await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-MANUTENCAO',
      macAddress: 'AA:BB:CC:02:01:06',
      description: 'Agente teste máquina em manutenção',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'maintenance',
    })

    // Act
    const response = await client
      .post('/api/agent/validate-user')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
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

  test('day-schedule deve retornar formato correto', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-06',
      macAddress: 'AA:BB:CC:02:01:07',
      description: 'Agente teste day-schedule',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .get('/api/agent/day-schedule')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)

    // Assert - verifica formato da resposta
    response.assertStatus(200)
    assert.property(response.body(), 'machineId')
    assert.property(response.body(), 'machineName')
    assert.property(response.body(), 'date')
    assert.property(response.body(), 'slots')
    assert.isArray(response.body().slots)
  })

  test('day-schedule deve aceitar parâmetro de data', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-06B',
      macAddress: 'AA:BB:CC:02:01:08',
      description: 'Agente teste day-schedule com data',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    const tomorrow = DateTime.now().plus({ days: 1 }).toISODate()

    // Act
    const response = await client
      .get(`/api/agent/day-schedule?date=${tomorrow}`)
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)

    // Assert
    response.assertStatus(200)
    assert.equal(response.body().date, tomorrow)
  })

  test('heartbeat deve incluir shouldBlock true para máquina em manutenção', async ({ client }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-MANUTENCAO-2',
      macAddress: 'AA:BB:CC:02:01:09',
      description: 'Agente teste heartbeat manutenção',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'maintenance',
    })

    // Act
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      shouldBlock: true,
      blockReason: 'MACHINE_MAINTENANCE',
    })
  })

  test('heartbeat deve retornar shouldBlock true quando usuário não tem alocação', async ({
    client,
  }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-09',
      macAddress: 'AA:BB:CC:02:01:0A',
      description: 'Agente teste heartbeat sem alocação',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Não cria alocação ativa para o usuário

    // Act - Usa user.id para verificar que o usuário não tem alocação
    const response = await client
      .post(`/api/agent/heartbeat?loggedUserId=${user.id}`)
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      shouldBlock: true,
      blockReason: 'NO_VALID_ALLOCATION',
    })
  })

  test('heartbeat deve incluir info de quickAllocate', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-QUICK-TEST',
      macAddress: 'AA:BB:CC:02:01:0B',
      description: 'Agente teste quick-allocate info',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)

    // Assert
    response.assertStatus(200)
    assert.property(response.body(), 'quickAllocate')
    assert.equal(response.body().quickAllocate.allowed, true)
    assert.equal(response.body().quickAllocate.maxDurationMinutes, 60)
  })

  test('quick-allocate deve criar alocação instantânea', async ({ client, assert }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-QUICK-01',
      macAddress: 'AA:BB:CC:02:01:0C',
      description: 'Agente teste quick-allocate',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post('/api/agent/quick-allocate')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
      .json({
        email: 'teste@teste.com',
        password: 'senha123',
        durationMinutes: 30,
      })

    // Assert
    response.assertStatus(201)
    response.assertBodyContains({
      success: true,
      reason: 'ALLOCATION_CREATED',
    })
    assert.equal(response.body().allocation.durationMinutes, 30)
    assert.equal(response.body().user.id, user.id)

    // Verifica que a alocação foi criada no banco
    const allocation = await Allocation.find(response.body().allocation.id)
    assert.isNotNull(allocation)
    assert.equal(allocation!.userId, user.id)
    assert.equal(allocation!.machineId, machine.id)
    assert.equal(allocation!.status, 'approved')
  })

  test('quick-allocate deve rejeitar se próxima alocação muito próxima', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-QUICK-02',
      macAddress: 'AA:BB:CC:02:01:0D',
      description: 'Agente teste quick-allocate tempo insuficiente',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Cria alocação que começa em 10 minutos (menos que o mínimo de 20)
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ minutes: 10 }),
      endTime: DateTime.now().plus({ minutes: 70 }),
      status: 'approved',
    })

    // Act
    const response = await client
      .post('/api/agent/quick-allocate')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
      .json({
        email: 'teste@teste.com',
        password: 'senha123',
      })

    // Assert
    response.assertStatus(409)
    response.assertBodyContains({
      success: false,
      reason: 'INSUFFICIENT_TIME',
    })
  })

  test('quick-allocate deve rejeitar credenciais inválidas', async ({ client }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-QUICK-03',
      macAddress: 'AA:BB:CC:02:01:0E',
      description: 'Agente teste quick-allocate credenciais inválidas',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post('/api/agent/quick-allocate')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
      .json({
        email: 'naoexiste@teste.com',
        password: 'senhaerrada',
      })

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      success: false,
      reason: 'INVALID_CREDENTIALS',
    })
  })

  test('report-login deve registrar usuário logado', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-10',
      macAddress: 'AA:BB:CC:02:01:0F',
      description: 'Agente teste report-login',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act
    const response = await client
      .post('/api/agent/report-login')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
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
      macAddress: 'AA:BB:CC:02:01:10',
      description: 'Agente teste report-logout',
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
      .header('X-Machine-Mac', machine.macAddress)

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
      macAddress: 'AA:BB:CC:02:01:11',
      description: 'Agente teste sync-specs',
      status: 'available',
    })

    // Act
    const response = await client
      .put('/api/agent/sync-specs')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
      .json({
        cpuModel: 'AMD Ryzen 9 5900X',
        gpuModel: 'NVIDIA RTX 4080',
        totalRamGb: 64,
        totalDiskGb: 2048,
        ipAddress: '192.168.1.100',
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
    const user = await User.create({
      fullName: 'Teste Telemetria',
      email: 'telemetria@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-AGENT-13',
      macAddress: 'AA:BB:CC:02:01:12',
      description: 'Agente teste telemetria',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'offline',
    })

    // Cria alocação ativa para que a telemetria seja aceita
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
    })

    // Act
    const response = await client
      .post('/api/agent/telemetry')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
      .json({
        cpuUsage: 450,
        cpuTemp: 650,
        gpuUsage: 200,
        gpuTemp: 550,
        ramUsage: 600,
        diskUsage: 300,
        downloadUsage: 50.5,
        uploadUsage: 10.2,
        loggedUserName: 'aluno.teste',
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
      .header('X-Machine-Mac', 'AA:BB:CC:00:00:01')

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      code: 'INVALID_TOKEN',
    })
  })
})
