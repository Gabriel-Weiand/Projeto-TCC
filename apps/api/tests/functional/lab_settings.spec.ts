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

  test('modo auto respeita .env em GET /api/config', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a@teste.com',
      password: '123',
      role: 'admin',
    })

    const putResp = await client
      .put('/api/v1/lab/settings')
      .loginAs(admin)
      .json({ publicNames: 'auto', requireAdminApproval: 'auto' })

    putResp.assertStatus(200)
    assert.equal(putResp.body().publicNames, 'auto')
    assert.equal(putResp.body().requireAdminApproval, 'auto')

    const configResp = await client.get('/api/config')
    configResp.assertStatus(200)
    const envPublic = ['1', 'true', 'yes', 'on'].includes(
      (process.env.LAB_ALLOCATION_PUBLIC_NAMES ?? '').trim().toLowerCase()
    )
    assert.equal(configResp.body().allocation.publicNames, envPublic)
  })

  test('modo true fixa publicNames independente do .env', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'b@teste.com',
      password: '123',
      role: 'admin',
    })

    const putResp = await client
      .put('/api/v1/lab/settings')
      .loginAs(admin)
      .json({ publicNames: 'true' })

    putResp.assertStatus(200)
    assert.equal(putResp.body().publicNames, 'true')

    const configResp = await client.get('/api/config')
    configResp.assertStatus(200)
    assert.isTrue(configResp.body().allocation.publicNames)
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
      .json({ publicNames: 'true' })

    response.assertStatus(403)
  })
})
