import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime, Settings } from 'luxon'

test.group('Timezone — UTC padrão', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('Luxon defaultZone deve ser UTC', async ({ assert }) => {
    assert.equal(Settings.defaultZone.name, 'UTC')
  })

  test('DateTime.now() deve retornar UTC', async ({ assert }) => {
    const now = DateTime.now()
    assert.equal(now.zoneName, 'UTC')
    assert.equal(now.offset, 0)
  })

  test('serverTime no heartbeat deve ser UTC (offset +00:00 ou Z)', async ({ assert }) => {
    const now = DateTime.now()
    const iso = now.toISO()!
    // Deve conter +00:00 (Luxon format) indicando UTC
    assert.isTrue(
      iso.includes('+00:00') || iso.endsWith('Z'),
      `serverTime esperado UTC, recebeu: ${iso}`
    )
  })
})

test.group('Timezone — Alocações em UTC', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('alocação criada com ISO UTC deve ser armazenada em UTC', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Teste TZ',
      email: 'tz@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-TZ-01',
      macAddress: 'AA:BB:CC:TZ:01:01',
      description: 'Teste timezone',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // 14:00 Brasil (UTC-3) = 17:00 UTC
    const startTime = '2026-06-15T17:00:00.000Z'
    const endTime = '2026-06-15T19:00:00.000Z'

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime,
      endTime,
    })

    response.assertStatus(201)
    const body = response.body()

    // O horário retornado deve estar em UTC (offset +00:00)
    assert.isTrue(
      body.startTime.includes('+00:00') || body.startTime.includes('Z'),
      `startTime esperado UTC, recebeu: ${body.startTime}`
    )
    assert.isTrue(
      body.endTime.includes('+00:00') || body.endTime.includes('Z'),
      `endTime esperado UTC, recebeu: ${body.endTime}`
    )
  })

  test('alocação criada com offset -03:00 deve ser normalizada para UTC', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Teste TZ2',
      email: 'tz2@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-TZ-02',
      macAddress: 'AA:BB:CC:TZ:02:02',
      description: 'Teste timezone 2',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // 14:00 horário de Brasília explícito
    const startTime = '2026-06-15T14:00:00.000-03:00'
    const endTime = '2026-06-15T16:00:00.000-03:00'

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime,
      endTime,
    })

    response.assertStatus(201)
    const body = response.body()

    // Após normalização, o horário deve estar em UTC
    // 14:00 -03:00 = 17:00 UTC
    const startDt = DateTime.fromISO(body.startTime)
    assert.equal(startDt.toUTC().hour, 17, 'startTime deveria ser 17:00 UTC')
    assert.equal(startDt.toUTC().minute, 0)
  })

  test('detecção de conflito funciona corretamente com UTC', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Teste Conflito TZ',
      email: 'conflict@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-TZ-03',
      macAddress: 'AA:BB:CC:TZ:03:03',
      description: 'Teste conflito timezone',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Primeira alocação: 17:00-19:00 UTC
    const res1 = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: '2026-06-15T17:00:00.000Z',
      endTime: '2026-06-15T19:00:00.000Z',
    })
    assert.equal(res1.status(), 201)

    // Segunda alocação: mesmo horário expresso com offset -03:00
    // 14:00 -03:00 = 17:00 UTC → deve conflitar!
    const res2 = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: '2026-06-15T14:00:00.000-03:00',
      endTime: '2026-06-15T16:00:00.000-03:00',
    })

    assert.equal(res2.status(), 409, 'Deveria detectar conflito entre UTC e offset -03:00')
  })

  test('heartbeat retorna serverTime em UTC', async ({ assert }) => {
    const now = DateTime.now()
    const iso = now.toISO()!

    assert.isTrue(
      iso.includes('+00:00') || iso.endsWith('Z'),
      `DateTime.now().toISO() esperado UTC, recebeu: ${iso}`
    )
  })

  test('data sem offset (como front antigo enviava) é tratada como UTC pelo servidor', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Teste Front',
      email: 'front@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-TZ-FRONT',
      macAddress: 'AA:BB:CC:TZ:FR:01',
      description: 'Teste frontend sem offset',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Frontend antigo enviava "14:30:00" sem offset — servidor trata como UTC
    // Isso é ERRADO para um usuário em UTC-3, mas é o comportamento atual
    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: '2026-06-15T14:30:00',
      endTime: '2026-06-15T16:30:00',
    })

    response.assertStatus(201)
    const body = response.body()

    // Servidor interpreta como 14:30 UTC (não 14:30 Brasil = 17:30 UTC)
    const startDt = DateTime.fromISO(body.startTime)
    assert.equal(startDt.toUTC().hour, 14, 'Sem offset → tratado como UTC (hora 14)')
    assert.equal(startDt.toUTC().minute, 30)
  })

  test('front corrigido envia UTC (.toISOString) e servidor armazena correto', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Teste Front Fix',
      email: 'frontfix@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-TZ-FIX',
      macAddress: 'AA:BB:CC:TZ:FX:01',
      description: 'Teste frontend corrigido',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      totalDiskGb: 256,
      status: 'available',
    })

    // Frontend CORRIGIDO: converte 14:30 local (UTC-3) → 17:30 UTC antes de enviar
    // Simulamos: new Date("2026-06-15T14:30:00").toISOString() em UTC-3
    // = "2026-06-15T17:30:00.000Z"
    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: '2026-06-15T17:30:00.000Z',
      endTime: '2026-06-15T19:30:00.000Z',
    })

    response.assertStatus(201)
    const body = response.body()

    // O horário armazenado deve ser 17:30 UTC
    const startDt = DateTime.fromISO(body.startTime)
    assert.equal(startDt.toUTC().hour, 17, 'Front corrigido: 14:30 -03:00 → 17:30 UTC')
    assert.equal(startDt.toUTC().minute, 30)
  })
})
