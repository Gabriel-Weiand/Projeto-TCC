import { test } from '@japa/runner'
import User from '#models/user'
import MachineGroup from '#models/machine_group'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Machine Groups', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('admin deve conseguir criar um grupo de máquinas', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a@teste.com',
      password: '123',
      role: 'admin',
    })

    const response = await client.post('/api/v1/machine-groups').loginAs(admin).json({
      title: 'Laboratório 1',
      description: 'Salas de aula',
    })

    response.assertStatus(201)
    response.assertBodyContains({ title: 'Laboratório 1' })
  })

  test('utilizador comum NÃO deve conseguir gerir grupos', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u@teste.com',
      password: '123',
      role: 'user',
    })

    const response = await client.post('/api/v1/machine-groups').loginAs(user).json({
      title: 'Lab 1',
    })

    response.assertStatus(403)
  })

  test('admin deve atualizar um grupo', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a2@teste.com',
      password: '123',
      role: 'admin',
    })
    const group = await MachineGroup.create({ title: 'Lab Antigo', description: 'Antigo' })

    const response = await client.put(`/api/v1/machine-groups/${group.id}`).loginAs(admin).json({
      title: 'Lab Novo',
    })

    response.assertStatus(200)
    await group.refresh()
    assert.equal(group.title, 'Lab Novo')
  })

  test('admin deve apagar um grupo', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a3@teste.com',
      password: '123',
      role: 'admin',
    })
    const group = await MachineGroup.create({ title: 'Lab Delete' })

    const response = await client.delete(`/api/v1/machine-groups/${group.id}`).loginAs(admin)

    response.assertStatus(204)
    const deleted = await MachineGroup.find(group.id)
    assert.isNull(deleted)
  })

  test('admin deve listar todos os grupos com as máquinas embutidas', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'ag@teste.com',
      password: '123',
      role: 'admin',
    })
    const group = await MachineGroup.create({ title: 'Lab Listagem' })

    const response = await client.get('/api/v1/machine-groups').loginAs(admin)

    response.assertStatus(200)
    assert.isArray(response.body())
    assert.isTrue(response.body().some((g: any) => g.title === 'Lab Listagem'))
  })

  test('admin deve visualizar um grupo específico', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'ag2@teste.com',
      password: '123',
      role: 'admin',
    })
    const group = await MachineGroup.create({ title: 'Lab Unico' })

    const response = await client.get(`/api/v1/machine-groups/${group.id}`).loginAs(admin)

    response.assertStatus(200)
    assert.equal(response.body().title, 'Lab Unico')
  })
})
