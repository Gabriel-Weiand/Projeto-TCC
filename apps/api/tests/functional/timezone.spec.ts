import { test } from '@japa/runner'
import User from '#models/user'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime, Settings } from 'luxon'
import { labConfig } from '#services/lab/config'
import { createTestMachine } from '../helpers/test_machine.js'
import {
  futureUtc,
  toBareUtcWallClock,
  toLabOffsetIso,
  toUtcIso,
} from '../helpers/future_allocation_times.js'

test.group('Timezone — processo e persistência', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('Luxon defaultZone segue TZ do laboratório (env)', async ({ assert }) => {
    assert.equal(Settings.defaultZone.name, labConfig.timezone)
  })

  test('DateTime.utc() permanece em UTC', async ({ assert }) => {
    const now = DateTime.utc()
    assert.equal(now.zoneName, 'UTC')
    assert.equal(now.offset, 0)
  })

  test('alocações serializam instantes em UTC (Z)', async ({ assert }) => {
    const iso = DateTime.utc(2026, 6, 15, 17, 0, 0).toISO()!
    assert.isTrue(iso.endsWith('Z') || iso.includes('+00:00'))
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

    const machine = await createTestMachine({
      name: 'PC-TZ-01',
      description: 'Teste timezone',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    const startUtc = futureUtc(2)
    const endUtc = startUtc.plus({ hours: 2 })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: toUtcIso(startUtc),
      endTime: toUtcIso(endUtc),
    })

    response.assertStatus(201)
    const body = response.body()

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

    const machine = await createTestMachine({
      name: 'PC-TZ-02',
      description: 'Teste timezone 2',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    const startUtc = futureUtc(2)
    const endUtc = startUtc.plus({ hours: 2 })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: toLabOffsetIso(startUtc),
      endTime: toLabOffsetIso(endUtc),
    })

    response.assertStatus(201)
    const body = response.body()

    const startDt = DateTime.fromISO(body.startTime).toUTC()
    assert.equal(startDt.toMillis(), startUtc.toMillis(), 'offset do lab deve normalizar ao mesmo instante UTC')
  })

  test('detecção de conflito funciona corretamente com UTC', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Teste Conflito TZ',
      email: 'conflict@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await createTestMachine({
      name: 'PC-TZ-03',
      description: 'Teste conflito timezone',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    const startUtc = futureUtc(2)
    const endUtc = startUtc.plus({ hours: 2 })

    const res1 = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: toUtcIso(startUtc),
      endTime: toUtcIso(endUtc),
    })
    assert.equal(res1.status(), 201)

    const res2 = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: toLabOffsetIso(startUtc),
      endTime: toLabOffsetIso(endUtc),
    })

    assert.equal(res2.status(), 409, 'Deveria detectar conflito entre UTC e offset -03:00')
  })

  test('data sem offset é tratada como UTC pelo servidor (append Z)', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Teste Front',
      email: 'front@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await createTestMachine({
      name: 'PC-TZ-FRONT',
      description: 'Teste frontend sem offset',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    const startUtc = futureUtc(2, 30)
    const endUtc = startUtc.plus({ hours: 2 })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: toBareUtcWallClock(startUtc),
      endTime: toBareUtcWallClock(endUtc),
    })

    response.assertStatus(201)
    const body = response.body()

    const startDt = DateTime.fromISO(body.startTime).toUTC()
    assert.equal(startDt.hour, startUtc.hour, 'Sem offset → tratado como UTC (mesma hora)')
    assert.equal(startDt.minute, startUtc.minute)
  })

  test('14:30 no fuso do lab (via ISO Z) persiste e relê sem deslocar +3h', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Roundtrip TZ',
      email: 'roundtrip@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await createTestMachine({
      name: 'PC-RT',
      description: 'Roundtrip',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    const startTime = DateTime.utc().plus({ hours: 1 }).startOf('second').toISO()!
    const endTime = DateTime.utc().plus({ hours: 4 }).startOf('second').toISO()!

    const created = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime,
      endTime,
    })
    created.assertStatus(201)

    const row = await Allocation.findOrFail(created.body().id)
    assert.equal(row.startTime.toUTC().toISO(), startTime)
    assert.equal(row.endTime.toUTC().toISO(), endTime)

    const listed = await client.get('/api/v1/allocations/my').loginAs(user)
    listed.assertStatus(200)
    const item = listed.body().data.find((a: { id: number }) => a.id === row.id)
    assert.exists(item)
    const listedStart = DateTime.fromISO(item.startTime).toUTC().toISO()
    assert.equal(listedStart, startTime)
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

    const machine = await createTestMachine({
      name: 'PC-TZ-FIX',
      description: 'Teste frontend corrigido',
      cpuModel: 'Intel i5',
      totalRamGb: 8,
      status: 'available',
    })

    // Parede no fuso do lab → instante UTC (como .toISOString() no browser)
    const labWall = futureUtc(3).setZone(labConfig.timezone)
    const startUtc = labWall.toUTC()
    const endUtc = startUtc.plus({ hours: 2 })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: toUtcIso(startUtc),
      endTime: toUtcIso(endUtc),
    })

    response.assertStatus(201)
    const body = response.body()

    const startDt = DateTime.fromISO(body.startTime).toUTC()
    assert.equal(startDt.toMillis(), startUtc.toMillis(), 'Front corrigido: parede local → instante UTC')
    assert.equal(startDt.minute, startUtc.minute)
  })
})
