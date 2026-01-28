import { test } from '@japa/runner'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Auth', (group) => {
  // Limpa o banco antes de cada teste
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('deve fazer login com credenciais válidas', async ({ client }) => {
    // Arrange: cria um usuário de teste
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act: tenta fazer login
    const response = await client.post('/api/v1/login').json({
      email: 'teste@teste.com',
      password: 'senha123',
    })

    // Assert: verifica a resposta
    response.assertStatus(200)
    response.assertBodyContains({
      type: 'bearer',
      user: {
        id: user.id,
        email: 'teste@teste.com',
      },
    })
  })

  test('deve rejeitar login com senha incorreta', async ({ client }) => {
    // Arrange
    await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.post('/api/v1/login').json({
      email: 'teste@teste.com',
      password: 'senhaerrada',
    })

    // Assert
    response.assertStatus(400)
  })

  test('deve rejeitar login com email inexistente', async ({ client }) => {
    // Act
    const response = await client.post('/api/v1/login').json({
      email: 'naoexiste@teste.com',
      password: 'qualquersenha',
    })

    // Assert
    response.assertStatus(400)
  })

  test('deve validar formato de email', async ({ client }) => {
    // Act
    const response = await client.post('/api/v1/login').json({
      email: 'emailinvalido',
      password: 'senha123',
    })

    // Assert
    response.assertStatus(422)
  })

  test('deve retornar dados do usuário autenticado em /me', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.get('/api/v1/me').loginAs(user)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      id: user.id,
      email: 'teste@teste.com',
      fullName: 'Teste User',
    })
  })

  test('deve negar acesso a /me sem autenticação', async ({ client }) => {
    // Act
    const response = await client.get('/api/v1/me')

    // Assert
    response.assertStatus(401)
  })

  test('deve fazer logout corretamente', async ({ client }) => {
    // Arrange
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Act
    const response = await client.delete('/api/v1/logout').loginAs(user)

    // Assert
    response.assertStatus(200)
    response.assertBodyContains({
      message: 'Logged out successfully',
    })
  })
})
