import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
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
    await MachineGroup.create({ title: 'Lab Listagem' })

    const response = await client.get('/api/v1/machine-groups').loginAs(admin)

    response.assertStatus(200)
    assert.isArray(response.body())
    assert.isTrue(response.body().some((g: any) => g.title === 'Lab Listagem'))
  })

  test('admin deve associar máquinas ao criar e atualizar grupo', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Machines',
      email: 'am@teste.com',
      password: '123',
      role: 'admin',
    })
    const m1 = await Machine.create({ name: 'PC-G1', description: 'Lab', status: 'available' })
    const m2 = await Machine.create({ name: 'PC-G2', description: 'Lab', status: 'available' })

    const createResp = await client.post('/api/v1/machine-groups').loginAs(admin).json({
      title: 'Grupo Sync',
      machineIds: [m1.id, m2.id],
    })
    createResp.assertStatus(201)
    const groupId = createResp.body().id
    assert.lengthOf(createResp.body().machines, 2)

    await m1.refresh()
    await m2.refresh()
    assert.equal(m1.machineGroupId, groupId)
    assert.equal(m2.machineGroupId, groupId)

    const updateResp = await client.put(`/api/v1/machine-groups/${groupId}`).loginAs(admin).json({
      machineIds: [m1.id],
    })
    updateResp.assertStatus(200)
    assert.lengthOf(updateResp.body().machines, 1)

    await m2.refresh()
    assert.isNull(m2.machineGroupId)
  })

  test('criar grupo com machineIds inválidos não persiste o grupo', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin Invalid',
      email: 'inv@teste.com',
      password: '123',
      role: 'admin',
    })

    const response = await client.post('/api/v1/machine-groups').loginAs(admin).json({
      title: 'Grupo Órfão',
      machineIds: [99_999],
    })

    response.assertStatus(400)
    response.assertBodyContains({ code: 'MACHINES_NOT_FOUND' })

    const orphan = await MachineGroup.findBy('title', 'Grupo Órfão')
    assert.isNull(orphan)
  })

  test('atualizar grupo com machineIds inválidos não altera título', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin Rollback',
      email: 'rb@teste.com',
      password: '123',
      role: 'admin',
    })
    const group = await MachineGroup.create({ title: 'Título Original' })

    const response = await client.put(`/api/v1/machine-groups/${group.id}`).loginAs(admin).json({
      title: 'Título Novo',
      machineIds: [88_888],
    })

    response.assertStatus(400)
    response.assertBodyContains({ code: 'MACHINES_NOT_FOUND' })

    await group.refresh()
    assert.equal(group.title, 'Título Original')
  })
})
