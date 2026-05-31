import { test } from '@japa/runner'

test.group('Utils (Rotas Públicas)', () => {
  test('alive deve retornar status ok', async ({ client, assert }) => {
    const response = await client.get('/api/alive')
    response.assertStatus(200)
    assert.equal(response.body().status, 'ok')
    assert.exists(response.body().uptime)
  })

  test('time deve retornar horário UTC correto', async ({ client, assert }) => {
    const response = await client.get('/api/time')
    response.assertStatus(200)
    assert.exists(response.body().utc)
    assert.exists(response.body().unixMs)
  })
})
