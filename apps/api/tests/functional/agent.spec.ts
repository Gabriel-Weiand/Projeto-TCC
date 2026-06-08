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
        telemetry: { telemetryPreset: 'eco', telemetryMode: 'auto' },
      },
    })

    await machine.refresh()
    assert.equal(machine.status, 'offline')
    assert.isNotNull(machine.lastSeenAt)
  })

  test('heartbeat deve atualizar currentSessions sem alterar status persistido', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({
      name: 'PC-01',
      description: 'Lab',
      token: 'token123',
      status: 'available',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ connectedUsers: ['lab.aluno_silva'] })

    response.assertStatus(200)

    await machine.refresh()
    assert.equal(machine.status, 'available')
    assert.deepEqual(machine.currentSessions, ['lab.aluno_silva'])
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
        },
      ],
      agentConfig: {
        telemetry: { telemetryPreset: 'fast', telemetryMode: 'auto' },
      },
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
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    response.assertBodyContains({
      provisioning: [
        {
          systemUsername: 'lab.aluno_ativo',
          accessState: 'full_shell',
        },
      ],
      agentConfig: {
        telemetry: { telemetryPreset: 'fast', telemetryMode: 'auto' },
      },
    })
  })

  test('coleta automática: ociosa eco, em alocação fast; custom fixo', async ({
    client,
  }) => {
    const machine = await Machine.create({
      name: 'PC-TEL-AUTO',
      description: 'Lab',
      token: 'tel-auto',
      telemetryPreset: 'eco',
    })

    const idle = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
    idle.assertStatus(200)
    idle.assertBodyContains({
      agentConfig: { telemetry: { telemetryPreset: 'eco', telemetryMode: 'auto' } },
    })

    const user = await User.create({
      fullName: 'Tel User',
      email: 'tel@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.tel_user',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 2 }),
      endTime: DateTime.now().plus({ hours: 1 }),
      status: 'approved',
    })

    const active = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
    active.assertStatus(200)
    active.assertBodyContains({
      agentConfig: { telemetry: { telemetryPreset: 'fast', telemetryMode: 'auto' } },
    })

    const customMachine = await Machine.create({
      name: 'PC-TEL-CUSTOM',
      description: 'Lab',
      token: 'tel-custom',
      telemetryPreset: 'custom',
      customAgentConfig: {
        intervalSeconds: 12,
        batchSize: 3,
        telemetrySet: { cpu: true, ramAndSwap: true },
      },
    })

    const customHb = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${customMachine.token}`)
    customHb.assertStatus(200)
    customHb.assertBodyContains({
      agentConfig: {
        telemetry: {
          telemetryPreset: 'custom',
          telemetryMode: 'custom',
          intervalSeconds: 12,
        },
      },
    })
  })

  test('grace: alocação após endTime ainda recebe full_shell', async ({ client }) => {
    const machine = await Machine.create({ name: 'PC-GRACE', description: 'Lab', token: 'tg' })
    const user = await User.create({
      fullName: 'Grace User',
      email: 'grace@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.grace_user',
      sshPublicKey: 'ssh-ed25519 AAAA grace@test',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().minus({ minutes: 5 }),
      status: 'approved',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    response.assertBodyContains({
      provisioning: [
        {
          systemUsername: 'lab.grace_user',
          accessState: 'full_shell',
        },
      ],
    })
  })

  test('finished antecipado: sem grace nem SFTP — revoga chave (no_key)', async ({ client, assert }) => {
    const machine = await Machine.create({
      name: 'PC-FIN-SFTP',
      description: 'Lab',
      token: 'tfs',
    })
    const user = await User.create({
      fullName: 'Finish Sftp',
      email: 'finish-sftp@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.finish_sftp',
      sshPublicKey: 'ssh-ed25519 AAAA finishsftp@test',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().minus({ minutes: 2 }),
      status: 'finished',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    const prov = response.body().provisioning[0]
    assert.equal(prov.systemUsername, 'lab.finish_sftp')
    assert.equal(prov.accessState, 'sftp_only')
    assert.isTrue(prov.revokeSshKey)
  })

  test('pós-SFTP: após grace recebe sftp_only com chave', async ({ client }) => {
    const machine = await Machine.create({ name: 'PC-SFTP', description: 'Lab', token: 'ts' })
    const user = await User.create({
      fullName: 'Sftp User',
      email: 'sftp@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.sftp_user',
      sshPublicKey: 'ssh-ed25519 AAAA sftp@test',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 2 }),
      endTime: DateTime.now().minus({ minutes: 20 }),
      status: 'approved',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    response.assertBodyContains({
      provisioning: [
        {
          systemUsername: 'lab.sftp_user',
          accessState: 'sftp_only',
        },
      ],
    })
  })

  test('alocação ativa prevalece sobre pós-SFTP de reserva anterior do mesmo usuário', async ({
    client,
  }) => {
    const machine = await Machine.create({
      name: 'PC-BACK2BACK',
      description: 'Lab',
      token: 'tbb',
    })
    const user = await User.create({
      fullName: 'Back To Back',
      email: 'back2back@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.back2back',
      sshPublicKey: 'ssh-ed25519 AAAA back2back@test',
    })

    const oldEnd = DateTime.utc().minus({ minutes: 30 })
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: oldEnd.minus({ hours: 1 }),
      endTime: oldEnd,
      status: 'approved',
    })

    const newStart = oldEnd.plus({ minutes: 20 })
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: newStart,
      endTime: newStart.plus({ hours: 2 }),
      status: 'approved',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    response.assertBodyContains({
      provisioning: [
        {
          systemUsername: 'lab.back2back',
          accessState: 'full_shell',
          revokeSshKey: false,
        },
      ],
    })
  })

  test('sem chave: após janela SFTP revoga authorized_keys', async ({ client, assert }) => {
    const machine = await Machine.create({ name: 'PC-NOKEY', description: 'Lab', token: 'tn' })
    const user = await User.create({
      fullName: 'Nokey User',
      email: 'nokey@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.nokey_user',
      sshPublicKey: 'ssh-ed25519 AAAA nokey@test',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ days: 3 }),
      endTime: DateTime.now().minus({ days: 2 }),
      status: 'approved',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    const prov = response.body().provisioning[0]
    assert.equal(prov.systemUsername, 'lab.nokey_user')
    assert.equal(prov.sshPublicKey, '')
    assert.isTrue(prov.revokeSshKey)
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
        gpuModel: 'NVIDIA GeForce RTX 3060',
        totalVramGb: 120,
        totalRamGb: 320,
        disks: [
          { device: '/dev/sda1', mountpoint: '/boot', fstype: 'ext4', totalGb: 1, freeGb: 0.5 },
          { device: '/dev/sda2', mountpoint: '/', fstype: 'ext4', totalGb: 500, freeGb: 200 },
        ],
        hostFingerprint: 'SHA256:abcd1234efgh5678ijkl_test_fingerprint', // <-- ENVIADO PELO AGENTE
      })

    response.assertStatus(200)
    await machine.refresh()
    assert.equal(machine.cpuModel, 'AMD Ryzen 9')
    assert.equal(machine.gpuModel, 'NVIDIA GeForce RTX 3060')
    assert.equal(machine.totalVramGb, 120)
    assert.equal(machine.totalRamGb, 320)
    assert.equal(machine.hostFingerprint, 'SHA256:abcd1234efgh5678ijkl_test_fingerprint') // <-- SALVO NO BANCO
    assert.equal(machine.disks?.length, 2)
  })

  test('telemetry deve aceitar dados em lote convertendo VRAM e processos', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({
      name: 'PC-01',
      description: 'Lab',
      token: 't7',
      status: 'available',
    })

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
  // 6. MIGRAÇÃO DE HOME (multi-disco, no_key da reserva antiga)
  // =========================================================================

  test('allowHomeMigration quando reserva antiga em no_key e nova active em outro disco', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({
      name: 'PC-MIGRATE',
      description: 'Lab',
      token: 't-migrate',
    })
    const user = await User.create({
      fullName: 'Disk User',
      email: 'disk@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.disk_user',
      sshPublicKey: 'ssh-ed25519 AAAA disk@test',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ days: 4 }),
      endTime: DateTime.now().minus({ days: 3 }),
      status: 'approved',
      homeMountpoint: '/data/lab',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 2 }),
      status: 'approved',
      homeMountpoint: '/scratch',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    const prov = response.body().provisioning[0]
    assert.equal(prov.systemUsername, 'lab.disk_user')
    assert.isTrue(prov.allowHomeMigration)
    assert.equal(prov.homeDirectory, '/scratch/lab.disk_user')
    assert.equal(prov.accessState, 'full_shell')
  })

  test('allowHomeMigration false quando reserva antiga ainda em post_sftp', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({
      name: 'PC-NOMIG',
      description: 'Lab',
      token: 't-nomig',
    })
    const user = await User.create({
      fullName: 'No Mig User',
      email: 'nomig@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.nomig_user',
      sshPublicKey: 'ssh-ed25519 AAAA nomig@test',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ days: 1 }),
      endTime: DateTime.now().minus({ hours: 3 }),
      status: 'approved',
      homeMountpoint: '/data/lab',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 2 }),
      status: 'approved',
      homeMountpoint: '/scratch',
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)

    response.assertStatus(200)
    const prov = response.body().provisioning[0]
    assert.notProperty(prov, 'allowHomeMigration')
  })

  // =========================================================================
  // 7. DESCOMISSIONAMENTO (exclusão admin)
  // =========================================================================

  test('heartbeat com pendingRemoval retorna decommission e provisioning vazio', async ({
    client,
    assert,
  }) => {
    const machine = await Machine.create({
      name: 'PC-DECOM',
      description: 'Lab',
      token: 't-decom',
      status: 'offline',
      customAgentConfig: { pendingRemoval: true },
    })

    const response = await client
      .post('/api/v1/agent/heartbeat')
      .header('Authorization', `Bearer ${machine.token}`)
      .json({ provisionedOsUsers: ['lab.orphan'] })

    response.assertStatus(200)
    assert.isTrue(response.body().decommission)
    assert.deepEqual(response.body().provisioning, [])
  })

  // =========================================================================
  // 8. SEGURANÇA
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
