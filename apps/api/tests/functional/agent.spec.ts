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

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      currentAllocation: {
        userId: user.id,
        userEmail: 'teste@teste.com',
      },
    })
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
    const machine = await Machine.create({
      name: 'PC-AGENT-09',
      macAddress: 'AA:BB:CC:02:01:0A',
      description: 'Agente teste heartbeat sem alocação',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Não cria alocação — qualquer usuário conectado deve ser bloqueado

    // Act - Envia usuário conectado sem alocação ativa
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ connectedUsers: ['usuario.sem.alocacao'] })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      shouldBlock: true,
      blockReason: 'NO_VALID_ALLOCATION',
    })
  })

  test('heartbeat deve atualizar loggedUser com usuários conectados via SSH', async ({
    client,
    assert,
  }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-10',
      macAddress: 'AA:BB:CC:02:01:0F',
      description: 'Agente teste connectedUsers',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Act - Agente reporta que 'aluno.silva' está conectado via SSH
    const response = await client
      .post('/api/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ connectedUsers: ['aluno.silva'] })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      connectedUsers: ['aluno.silva'],
      connectedCount: 1,
    })

    await machine.refresh()
    assert.equal(machine.loggedUser, 'aluno.silva')
    assert.equal(machine.status, 'occupied')
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

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      code: 'INVALID_TOKEN',
    })
  })

})
