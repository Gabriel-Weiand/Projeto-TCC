import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import MachineUser from '#models/machine_user'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

test.group('Agent API', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // =========================================================================
  // 1. HEARTBEAT: BÁSICO E STATUS
  // =========================================================================

  test('heartbeat deve manter máquina online e responder com agentConfig', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({
      name: 'PC-AGENT-01',
      description: 'Lab',
      token: 'token123',
      status: 'offline',
      telemetryPreset: 'eco',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    response.assertBodyContains({
      status: 'acknowledged',
      accessControl: { shouldBlock: false },
      agentConfig: {
        telemetry: { telemetryPreset: 'eco' },
      },
    })

    await machine.refresh()
    assert.equal(machine.status, 'available')
    assert.isNotNull(machine.lastSeenAt)
  })

  test('heartbeat deve atualizar currentSessions e mudar status para occupied', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 'token123' })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ connectedUsers: ['lab.aluno_silva'] })

    response.assertStatus(200)

    await machine.refresh()
    assert.equal(machine.status, 'occupied') // Mudou porque há alguém conectado
    assert.deepEqual(machine.currentSessions, ['lab.aluno_silva']) // Registrou a sessão na máquina
  })

  // =========================================================================
  // 2. HEARTBEAT: PROVISIONAMENTO E CONTROLE DE ACESSO
  // =========================================================================

  test('alocação em T-5 minutos deve enviar usuário com acesso restrito (sftp_only)', async ({
    client,
  }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 't1' })
    const user = await User.create({
      fullName: 'Aluno T5',
      email: 't5@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.aluno_t5',
    })

    // Alocação começa daqui a 3 minutos
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ minutes: 3 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    response.assertBodyContains({
      provisioning: [
        {
          systemUsername: 'lab.aluno_t5',
          accessState: 'sftp_only', // Impede o terminal antes da hora
          isSudo: false,
        },
      ],
    })
  })

  test('alocação ativa deve enviar usuário com acesso total (full_shell)', async ({ client }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 't2' })
    const user = await User.create({
      fullName: 'Aluno Ativo',
      email: 'ativa@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.aluno_ativo',
    })

    // Alocação já começou
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
      isSudo: true, // Vamos testar o sudo também
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    response.assertBodyContains({
      provisioning: [
        {
          systemUsername: 'lab.aluno_ativo',
          accessState: 'full_shell', // Terminal liberado!
          isSudo: true, // Sudo liberado!
        },
      ],
    })
  })

  // =========================================================================
  // 3. HEARTBEAT: RECONCILIAÇÃO (DRIFT DETECTION)
  // =========================================================================

  test('drift: deve remover do BD usuário que sumiu do SO e não tem alocação', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 't3' })
    const user = await User.create({
      fullName: 'Fantasma',
      email: 'f@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.fantasma',
    })

    // Cadastra na tabela pivô como se existisse no SO
    const machineUser = await MachineUser.create({
      machineId: machine.id,
      userId: user.id,
      osUsername: 'lab.fantasma',
    })

    // Agente manda o heartbeat dizendo que a máquina está vazia
    await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ provisionedOsUsers: [] })

    // O AdonisJS deve ter percebido a discrepância e apagado do banco
    const exists = await MachineUser.find(machineUser.id)
    assert.isNull(exists)
  })

  test('drift: deve forçar recriação de usuário que sumiu do SO mas TEM alocação ativa', async ({
    client,
  }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 't4' })
    const user = await User.create({
      fullName: 'Essencial',
      email: 'e@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.essencial',
    })

    // Alocação rolando
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
    })

    // Agente relata que algum admin apagou o cara do SO
    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ provisionedOsUsers: [] })

    // A API não aceita o desvio e ordena a recriação imediata
    response.assertBodyContains({
      provisioning: [{ systemUsername: 'lab.essencial', accessState: 'full_shell' }],
    })
  })

  // =========================================================================
  // 4. HEARTBEAT: AUDITORIA DE SSH
  // =========================================================================

  test('deve registrar tentativas de conexão SSH relatadas pelo agente', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 't5' })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        sshAttempts: [
          {
            sourceIp: '192.168.1.100',
            targetUsername: 'root',
            status: 'failed',
            authMethod: 'password',
          },
          { sourceIp: '189.50.20.1', targetUsername: 'lab.teste', status: 'invalid_user' },
        ],
      })

    response.assertStatus(200)

    const attempts = await SshConnectionAttempt.query().where('machineId', machine.id)
    assert.equal(attempts.length, 2)
    assert.equal(attempts[0].targetUsername, 'root')
  })

  // =========================================================================
  // 5. SYNC-SPECS E TELEMETRIA
  // =========================================================================

  test('sync-specs deve atualizar especificações da máquina incluindo fingerprint', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 't6' })

    const response = await client
      .put('/api/v1/agent/sync-specs')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({
        cpuModel: 'AMD Ryzen 9',
        totalRamGb: 32,
        disks: [
          { device: '/dev/sda1', mountpoint: '/boot', fstype: 'ext4', totalGb: 1, freeGb: 0.5 },
          { device: '/dev/sda2', mountpoint: '/', fstype: 'ext4', totalGb: 500, freeGb: 200 },
        ],
        hostFingerprint: 'SHA256:abcd1234efgh5678ijkl_test_fingerprint', // <-- ENVIADO PELO AGENTE
      })

    response.assertStatus(200)
    await machine.refresh()
    assert.equal(machine.cpuModel, 'AMD Ryzen 9')
    assert.equal(machine.totalRamGb, 32)
    assert.equal(machine.hostFingerprint, 'SHA256:abcd1234efgh5678ijkl_test_fingerprint') // <-- SALVO NO BANCO
    assert.isArray(machine.disks)
    assert.lengthOf(machine.disks, 2)
  })

  test('telemetry deve aceitar dados em lote convertendo VRAM e processos', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({ name: 'PC-01', description: 'Lab', token: 't7' })

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
            gpuPowerWatts: 150,
            ramTotalGb: 320,
            ramUsedGb: 160,
            vramTotalGb: 120,
            vramUsedGb: 40, // Note que agora o Python envia Gb * 10
            diskReadMbps: 300,
            diskWriteMbps: 120,
            processes: [
              // Testando o array de processos do psutil
              { pid: 1234, name: 'python3', username: 'lab.aluno', cpuPercent: 850, ramMb: 2048 },
            ],
          },
        ],
      })

    response.assertStatus(204)
    await machine.refresh()
    assert.equal(machine.status, 'available')
  })

  // =========================================================================
  // 6. SEGURANÇA
  // =========================================================================

  test('deve rejeitar requisição sem token', async ({ client }) => {
    const response = await client.post('/api/v1/agent/heartbeat')
    response.assertStatus(401)
  })

  test('deve rejeitar requisição com token inválido', async ({ client }) => {
    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', 'Bearer token_falso')
    response.assertStatus(401)
  })
})
