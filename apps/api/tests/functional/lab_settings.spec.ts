import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { existsSync, unlinkSync } from 'node:fs'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Lab Settings', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  group.each.teardown(() => {
    const path = app.makePath('storage/lab/runtime_settings.json')
    if (existsSync(path)) unlinkSync(path)
  })

  test('GET /api/config reflete publicNames após PUT /lab/settings', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a@teste.com',
      password: '123',
      role: 'admin',
    })

    const putResp = await client
      .put('/api/v1/lab/settings')
      .loginAs(admin)
      .json({ publicNames: true, requireAdminApproval: true })

    putResp.assertStatus(200)
    assert.isTrue(putResp.body().publicNames)
    assert.isTrue(putResp.body().requireAdminApproval)

    const configResp = await client.get('/api/config')
    configResp.assertStatus(200)
    assert.isTrue(configResp.body().allocation.publicNames)
    assert.isTrue(configResp.body().allocation.requireAdminApproval)
  })

  test('utilizador comum é bloqueado em /lab/settings', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u@teste.com',
      password: '123',
      role: 'user',
    })

    const response = await client
      .put('/api/v1/lab/settings')
      .loginAs(user)
      .json({ publicNames: true })

    response.assertStatus(403)
  })
})
