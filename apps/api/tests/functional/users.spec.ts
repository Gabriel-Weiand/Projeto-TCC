import { test } from '@japa/runner'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Users', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('admin deve criar um novo usuário', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    // Act
    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Novo Usuário',
      email: 'novo@teste.com',
      password: 'senha12345',
    })

    // Assert
    response.assertStatus(201)
    response.assertBodyContains({
      fullName: 'Novo Usuário',
      email: 'novo@teste.com',
    })
  })

  test('admin deve criar usuário com role admin', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    // Act
    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Novo Admin',
      email: 'novoadmin@teste.com',
      password: 'senha12345',
      role: 'admin',
    })

    // Assert
    response.assertStatus(201)
    response.assertBodyContains({
      role: 'admin',
    })
  })

  test('usuário comum NÃO deve criar usuários', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'User Normal',
      email: 'user@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.post('/api/v1/users').loginAs(user).json({
      fullName: 'Tentativa',
      email: 'tentativa@teste.com',
      password: 'senha12345',
    })

    // Assert
    response.assertStatus(403)
  })

  test('admin deve listar todos os usuários', async ({ client, assert }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    await User.createMany([
      { fullName: 'User 1', email: 'user1@teste.com', password: 'senha123', role: 'user' },
      { fullName: 'User 2', email: 'user2@teste.com', password: 'senha123', role: 'user' },
    ])

    // Act
    const response = await client.get('/api/v1/users').loginAs(admin)

    // Assert
    response.assertStatus(200)
    assert.isArray(response.body())
    assert.isAtLeast(response.body().length, 3) // admin + 2 users
  })

  test('usuário comum NÃO deve listar usuários', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'User Normal',
      email: 'user@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.get('/api/v1/users').loginAs(user)

    // Assert
    response.assertStatus(403)
  })

  test('admin deve visualizar detalhes de um usuário', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user = await User.create({
      fullName: 'User Detalhe',
      email: 'detalhe@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.get(`/api/v1/users/${user.id}`).loginAs(admin)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      id: user.id,
      fullName: 'User Detalhe',
      email: 'detalhe@teste.com',
    })
  })

  test('usuário deve poder atualizar seus próprios dados', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'User Original',
      email: 'original@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.put(`/api/v1/users/${user.id}`).loginAs(user).json({
      fullName: 'User Atualizado',
    })

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      fullName: 'User Atualizado',
    })
  })

  test('admin deve deletar um usuário', async ({ client, assert }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user = await User.create({
      fullName: 'User Deletar',
      email: 'deletar@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.delete(`/api/v1/users/${user.id}`).loginAs(admin)

    // Assert
    response.assertStatus(204)

    const deleted = await User.find(user.id)
    assert.isNull(deleted)
  })

  test('NÃO deve criar usuário com email duplicado', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    await User.create({
      fullName: 'Existente',
      email: 'existente@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Duplicado',
      email: 'existente@teste.com',
      password: 'senha12345',
    })

    // Assert
    response.assertStatus(422) // Validation error
  })

  test('deve validar senha mínima de 8 caracteres', async ({ client }) => {
    // Arrange
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    // Act
    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Senha Curta',
      email: 'senhacurta@teste.com',
      password: '123', // muito curta
    })

    // Assert
    response.assertStatus(422)
  })
})
