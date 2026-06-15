import { test } from '@japa/runner'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { getLabTelemetryPresets } from '#services/telemetry/presets'

test.group('Lab telemetry presets', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET /api/config expõe presets fast e eco', async ({ client, assert }) => {
    const response = await client.get('/api/config')
    response.assertStatus(200)
    assert.exists(response.body().telemetry)
    assert.equal(response.body().telemetry.defaultOfflinePreset, 'eco')
    assert.equal(response.body().telemetry.collectionRules.inAllocation, 'fast')
    assert.equal(response.body().telemetry.collectionRules.idle, 'eco')
    assert.exists(response.body().telemetry.presets.fast)
    assert.exists(response.body().telemetry.presets.eco)
    assert.equal(
      response.body().telemetry.presets.fast.intervalSeconds,
      getLabTelemetryPresets().fast.intervalSeconds
    )
    assert.property(response.body().allocation, 'publicNames')
    assert.isFalse(response.body().allocation.publicNames)
  })

  test('admin pode ler e atualizar presets globais', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Lab Tel',
      email: 'admin-lab-tel@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const getRes = await client.get('/api/v1/lab/telemetry-presets').loginAs(admin)
    getRes.assertStatus(200)
    assert.exists(getRes.body().fast)
    assert.exists(getRes.body().eco)

    const putRes = await client
      .put('/api/v1/lab/telemetry-presets')
      .loginAs(admin)
      .json({
        fast: {
          intervalSeconds: 20,
          batchSize: 6,
          telemetrySet: getRes.body().fast.telemetrySet,
        },
        eco: {
          intervalSeconds: 90,
          batchSize: 15,
          telemetrySet: getRes.body().eco.telemetrySet,
        },
      })

    putRes.assertStatus(200)
    assert.equal(putRes.body().fast.intervalSeconds, 20)
    assert.equal(putRes.body().eco.intervalSeconds, 90)

    const resolved = getLabTelemetryPresets()
    assert.equal(resolved.fast.intervalSeconds, 20)
    assert.equal(resolved.eco.intervalSeconds, 90)
  })

  test('usuário comum não pode alterar presets globais', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'user-lab-tel@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client
      .put('/api/v1/lab/telemetry-presets')
      .loginAs(user)
      .json({
        fast: {
          intervalSeconds: 5,
          batchSize: 5,
          telemetrySet: getLabTelemetryPresets().fast.telemetrySet,
        },
        eco: {
          intervalSeconds: 60,
          batchSize: 15,
          telemetrySet: getLabTelemetryPresets().eco.telemetrySet,
        },
      })

    response.assertStatus(403)
  })

  test('rejeita intervalo menor que 10s nos presets globais', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin Tel Min',
      email: 'admin-tel-min@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const presets = getLabTelemetryPresets()

    const response = await client
      .put('/api/v1/lab/telemetry-presets')
      .loginAs(admin)
      .json({
        fast: {
          intervalSeconds: 5,
          batchSize: presets.fast.batchSize,
          telemetrySet: presets.fast.telemetrySet,
        },
        eco: presets.eco,
      })

    response.assertStatus(422)
  })

  test('rejeita intervalo fora de 10–300s', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin Tel Val',
      email: 'admin-tel-val@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const presets = getLabTelemetryPresets()

    const response = await client
      .put('/api/v1/lab/telemetry-presets')
      .loginAs(admin)
      .json({
        fast: {
          intervalSeconds: 301,
          batchSize: presets.fast.batchSize,
          telemetrySet: presets.fast.telemetrySet,
        },
        eco: presets.eco,
      })

    response.assertStatus(422)
  })

  test('força CPU e RAM/Swap mesmo se desligados no payload', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Tel Mand',
      email: 'admin-tel-mand@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const presets = getLabTelemetryPresets()

    const putRes = await client
      .put('/api/v1/lab/telemetry-presets')
      .loginAs(admin)
      .json({
        fast: {
          intervalSeconds: 25,
          batchSize: presets.fast.batchSize,
          telemetrySet: { ...presets.fast.telemetrySet, cpu: false, ramAndSwap: false },
        },
        eco: presets.eco,
      })

    putRes.assertStatus(200)
    assert.isTrue(putRes.body().fast.telemetrySet.cpu)
    assert.isTrue(putRes.body().fast.telemetrySet.ramAndSwap)
  })

  test('rejeita processCaptureConfig.topX acima de 100', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin Tel Top',
      email: 'admin-tel-top@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const presets = getLabTelemetryPresets()

    const response = await client
      .put('/api/v1/lab/telemetry-presets')
      .loginAs(admin)
      .json({
        fast: {
          ...presets.fast,
          processCaptureConfig: { compareMetric: 'cpuPercent', topX: 101 },
        },
        eco: presets.eco,
      })

    response.assertStatus(422)
  })
})
