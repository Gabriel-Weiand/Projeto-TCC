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
      description: 'Agente teste heartbeat',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'offline',
    })

    // Act
    const response = await client
      .post('/api/v1/agent/heartbeat')
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
      description: 'Agente teste heartbeat com alocação',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
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
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      currentAllocation: {
        userId: user.id,
        userName: 'Teste User',
      },
    })
  })

  test('heartbeat deve incluir shouldBlock true para máquina em manutenção', async ({ client }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-MANUTENCAO-2',
      description: 'Agente teste heartbeat manutenção',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'maintenance',
    })

    // Act
    const response = await client
      .post('/api/v1/agent/heartbeat')
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
      description: 'Agente teste heartbeat sem alocação',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    // Não cria alocação — qualquer usuário conectado deve ser bloqueado

    // Act - Envia usuário conectado sem alocação ativa
    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ connectedUsers: ['usuario.sem.alocacao'] })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      shouldBlock: true,
      blockReason: 'NO_VALID_ALLOCATION',
    })
  })

  test('heartbeat deve atualizar activeUsers com usuários conectados via SSH', async ({
    client,
    assert,
  }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-10',
      description: 'Agente teste connectedUsers',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    // Act - Agente reporta que 'aluno.silva' está conectado via SSH
    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ connectedUsers: ['aluno.silva'] })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      connectedUsers: ['aluno.silva'],
      connectedCount: 1,
    })

    await machine.refresh()
    assert.deepEqual(machine.activeUsers, ['aluno.silva'])
    assert.equal(machine.status, 'occupied')
  })

  test('sync-specs deve atualizar especificações da máquina', async ({ client, assert }) => {
    // Arrange
    const machine = await Machine.create({
      name: 'PC-AGENT-12',
      description: 'Agente teste sync-specs',
      status: 'available',
    })

    // Act
    const response = await client
      .put('/api/v1/agent/sync-specs')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        cpuModel: 'AMD Ryzen 9 5900X',
        gpuModel: 'NVIDIA RTX 4080',
        totalRamGb: 64,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', totalGb: 2048, freeGb: 1024 },
        ],
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
      description: 'Agente teste telemetria',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
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
    const connectedSince = Math.floor(Date.now() / 1000)
    const response = await client
      .post('/api/v1/agent/telemetry')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        data: [
          {
            timestamp: new Date().toISOString(),
            cpuUsage: 450,
            cpuTemp: 650,
            gpuUsage: 200,
            gpuTemp: 550,
            ramTotalGb: 160,
            ramUsedGb: 80,
            diskReadMbps: 300,
            diskWriteMbps: 120,
            downloadMbps: 50.5,
            uploadMbps: 10.2,
            moboTemperature: 420,
            activeUsers: [
              {
                username: 'aluno.teste',
                terminal: 'pts/0',
                host: 'localhost',
                isSsh: true,
                connectedSince,
              },
            ],
          },
        ],
      })

    // Assert
    response.assertStatus(204)

    await machine.refresh()
    assert.equal(machine.status, 'available')
    assert.isNotNull(machine.lastSeenAt)
  })

  test('deve rejeitar requisição sem token', async ({ client }) => {
    // Act
    const response = await client.post('/api/v1/agent/heartbeat')

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      code: 'MISSING_HEADER',
    })
  })

  test('deve rejeitar requisição com token inválido', async ({ client }) => {
    // Act
    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', 'Bearer token_invalido_123')

    // Assert
    response.assertStatus(401)
    response.assertBodyContains({
      code: 'INVALID_TOKEN',
    })
  })

})
