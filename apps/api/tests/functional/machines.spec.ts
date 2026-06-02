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
        description: 'Computador 1',
        cpuModel: 'Intel i5',
        totalRamGb: 8,
        status: 'available',
      },
      {
        name: 'PC-02',
        description: 'Computador 2',
        cpuModel: 'Intel i7',
        totalRamGb: 16,
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
      description: 'Máquina para teste de atualização',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
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
      description: 'Máquina para teste de exclusão',
      cpuModel: 'Intel i3',
      totalRamGb: 4,
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

  test('GET show não expõe token do agente (nem para admin)', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-COM-TOKEN',
      description: 'Máquina com token visível',
      cpuModel: 'Intel i5',
      totalRamGb: 80,
      status: 'available',
    })

    const response = await client.get(`/api/v1/machines/${machine.id}`).loginAs(admin)

    response.assertStatus(200)
    assert.notExists(response.body().token)
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
      description: 'Máquina para regenerar token',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
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
      description: 'Máquina para teste de permissão de token',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
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
      description: 'Máquina para teste de manutenção',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
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

  test('deve listar histórico de alocações de uma máquina (anonimizado para users)', async ({
    client,
    assert,
  }) => {
    const owner = await User.create({
      fullName: 'Dono',
      email: 'dono.hist@teste.com',
      password: '123',
      role: 'user',
    })
    const viewer = await User.create({
      fullName: 'Aluno',
      email: 'aluno.hist@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-HIST',
      description: 'Lab',
      status: 'available',
    })
    await Allocation.create({
      userId: owner.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 1 }),
      status: 'approved',
    })

    const prev = process.env.LAB_ALLOCATION_PUBLIC_NAMES
    delete process.env.LAB_ALLOCATION_PUBLIC_NAMES

    const response = await client
      .get(`/api/v1/machines/${machine.id}/allocations`)
      .loginAs(viewer)

    if (prev !== undefined) process.env.LAB_ALLOCATION_PUBLIC_NAMES = prev

    response.assertStatus(200)
    assert.notExists(response.body().data[0]?.user)
    assert.isFalse(response.body().data[0]?.isOwn)
  })

  test('com LAB_ALLOCATION_PUBLIC_NAMES=true expõe nome do responsável', async ({
    client,
    assert,
  }) => {
    const owner = await User.create({
      fullName: 'Maria Silva',
      email: 'maria.pub@teste.com',
      password: '123',
      role: 'user',
    })
    const viewer = await User.create({
      fullName: 'Aluno',
      email: 'aluno.pub@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await Machine.create({
      name: 'PC-PUB',
      description: 'Lab',
      status: 'available',
    })
    await Allocation.create({
      userId: owner.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 1 }),
      status: 'approved',
    })

    const prev = process.env.LAB_ALLOCATION_PUBLIC_NAMES
    process.env.LAB_ALLOCATION_PUBLIC_NAMES = 'true'

    const response = await client
      .get(`/api/v1/machines/${machine.id}/allocations`)
      .loginAs(viewer)

    if (prev !== undefined) process.env.LAB_ALLOCATION_PUBLIC_NAMES = prev
    else delete process.env.LAB_ALLOCATION_PUBLIC_NAMES

    response.assertStatus(200)
    assert.equal(response.body().data[0]?.user?.fullName, 'Maria Silva')
    assert.isFalse(response.body().data[0]?.isOwn)
  })
  test('admin deve conseguir solicitar relatório de processos on-demand', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin.process@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-PROCESS',
      description: 'Máquina para teste on-demand',
      status: 'available',
    })

    // Act: Admin pede um relatório focando no Top 15 processos que usam mais de 100MB de VRAM
    const response = await client
      .post(`/api/v1/machines/${machine.id}/request-processes`)
      .loginAs(admin)
      .json({
        topX: 15,
        vramMb: 100,
      })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      message: 'Gatilho enviado. Agente coletará o Top 15 nos próximos envios.',
    })

    // Verifica se o AdonisJS guardou o timestamp e os limites corretamente no JSONB
    await machine.refresh()
    const config = machine.customAgentConfig as any
    assert.isNotNull(config.onDemandProcessConfig)
    assert.exists(config.onDemandProcessConfig.requestTimestamp)
    assert.equal(config.onDemandProcessConfig.thresholds.topX, 15)
    assert.equal(config.onDemandProcessConfig.thresholds.vramMb, 100)
    // Verifica se ele assumiu o valor padrão (2.0) para os campos que não enviámos
    assert.equal(config.onDemandProcessConfig.thresholds.cpuPercent, 2)
  })
})
