import { test } from '@japa/runner'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Users', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // =========================================================================
  // 1. ROTAS DE ADMINISTRAÇÃO (/api/v1/users)
  // =========================================================================

  test('admin deve criar um novo usuário e gerar system_username corretamente', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Gabriel Weiand Júnior', // Com acentos e espaços
      email: 'gabriel@teste.com',
      password: 'senha12345',
    })

    response.assertStatus(201)
    response.assertBodyContains({
      fullName: 'Gabriel Weiand Júnior',
      email: 'gabriel@teste.com',
      systemUsername: 'lab.gabriel_weiand_junior', // Verifica o Hook @beforeCreate
    })
  })

  test('sistema deve resolver conflitos de system_username idênticos', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    // Cria o primeiro João
    await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'João Silva',
      email: 'joao1@teste.com',
      password: 'senha12345',
    })

    // Cria o segundo João (exatamente o mesmo nome)
    const response2 = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'João Silva',
      email: 'joao2@teste.com',
      password: 'senha12345',
    })

    response2.assertStatus(201)
    response2.assertBodyContains({ systemUsername: 'lab.joao_silva1' }) // Adicionou o sufixo numérico
  })

  test('admin deve criar usuário com role admin', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Novo Admin',
      email: 'novoadmin@teste.com',
      password: 'senha12345',
      role: 'admin',
    })

    response.assertStatus(201)
    response.assertBodyContains({ role: 'admin' })
  })

  test('admin deve listar usuários', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client.get('/api/v1/users').loginAs(admin)

    response.assertStatus(200)
    response.assertBodyContains([{ email: 'admin@teste.com' }, { email: 'teste@teste.com' }])
  })

  test('admin deve visualizar um usuário específico', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'User Ver',
      email: 'ver@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client.get(`/api/v1/users/${user.id}`).loginAs(admin)

    response.assertStatus(200)
    response.assertBodyContains({ fullName: 'User Ver' })
  })

  test('admin deve atualizar um usuário', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'Old Name',
      email: 'old@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client.put(`/api/v1/users/${user.id}`).loginAs(admin).json({
      fullName: 'New Name',
    })

    response.assertStatus(200)
    await user.refresh()
    assert.equal(user.fullName, 'New Name')
  })

  test('admin deve excluir um usuário', async ({ client, assert }) => {
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

    const response = await client.delete(`/api/v1/users/${user.id}`).loginAs(admin)

    response.assertStatus(204)
    const deleted = await User.find(user.id)
    assert.isNull(deleted)
  })

  // =========================================================================
  // 2. ROTAS DE PERFIL DO ALUNO (/api/v1/users/me)
  // =========================================================================

  test('usuário deve atualizar o próprio perfil via /me', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'John',
      email: 'john@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client.put('/api/v1/users/me').loginAs(user).json({
      fullName: 'John Updated',
    })

    response.assertStatus(200)
    await user.refresh()
    assert.equal(user.fullName, 'John Updated')
  })

  test('usuário NÃO pode alterar a própria role para admin', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Hacker',
      email: 'hacker@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client.put('/api/v1/users/me').loginAs(user).json({
      role: 'admin', // Tentativa de injeção
    })

    response.assertStatus(200) // O update passa, mas a role deve ser ignorada pelo controller
    await user.refresh()
    assert.equal(user.role, 'user')
  })

  test('usuário deve fazer upload da chave SSH válida', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'John',
      email: 'john2@teste.com',
      password: 'senha123',
      role: 'user',
    })
    const sshKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... chave_de_teste'

    const response = await client.put('/api/v1/users/me/ssh-key').loginAs(user).json({
      sshPublicKey: sshKey,
    })

    response.assertStatus(200)
    await user.refresh()
    assert.equal(user.sshPublicKey, sshKey)
  })

  test('deve rejeitar upload de chave SSH inválida', async ({ client }) => {
    const user = await User.create({
      fullName: 'John',
      email: 'john3@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client.put('/api/v1/users/me/ssh-key').loginAs(user).json({
      sshPublicKey: 'chave_falsa_sem_formato',
    })

    response.assertStatus(422) // Validação falha porque não começa com ssh-
  })

  // =========================================================================
  // 3. VALIDAÇÕES GERAIS (Tratamento de Erros)
  // =========================================================================

  test('NÃO deve criar usuário com email duplicado', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin2@teste.com',
      password: 'senha123',
      role: 'admin',
    })
    await User.create({
      fullName: 'Existente',
      email: 'existente@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Duplicado',
      email: 'existente@teste.com',
      password: 'senha12345',
    })

    response.assertStatus(422)
  })

  test('deve validar senha mínima de 8 caracteres', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin3@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const response = await client.post('/api/v1/users').loginAs(admin).json({
      fullName: 'Senha Curta',
      email: 'curta@teste.com',
      password: '123',
    })

    response.assertStatus(422)
  })

  test('admin deve listar histórico de alocações de um usuário específico', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'a.hist@teste.com',
      password: '123',
      role: 'admin',
    })
    const response = await client.get(`/api/v1/users/${admin.id}/allocations`).loginAs(admin)

    response.assertStatus(200)
    assert.exists(response.body().meta.total)
  })
})
