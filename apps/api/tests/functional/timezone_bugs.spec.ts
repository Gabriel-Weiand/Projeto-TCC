import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { autoFinalizeExpired } from '#services/allocation_summarizer'

/**
 * Helpers reutilizáveis para os testes.
 */
let macCounter = 0

async function createUserAndMachine(suffix: string) {
  macCounter++
  const hex = macCounter.toString(16).padStart(4, '0').toUpperCase()

  const user = await User.create({
    fullName: `User ${suffix}`,
    email: `${suffix}@test.com`,
    password: 'senha123',
    role: 'admin',
  })

  const machine = await Machine.create({
    name: `PC-${suffix}`,
    macAddress: `AA:BB:CC:DD:${hex.slice(0, 2)}:${hex.slice(2, 4)}`,
    description: `Machine ${suffix}`,
    cpuModel: 'Intel i5',
    totalRamGb: 8,
    totalDiskGb: 256,
    status: 'available',
  })

  return { user, machine }
}

// ─────────────────────────────────────────────────────────────────────────
// Bug 1: autoFinalizeExpired usa formato de data incompatível com SQLite
// ─────────────────────────────────────────────────────────────────────────
test.group('Bug: autoFinalizeExpired — comparação de datas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('NÃO deve finalizar alocação que ainda não expirou', async ({ assert }) => {
    const { user, machine } = await createUserAndMachine('finexp1')

    // Alocação aprovada que termina daqui a 2 horas — NÃO deve ser finalizada
    const future = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 2 }),
      status: 'approved',
    })

    const count = await autoFinalizeExpired()

    await future.refresh()
    assert.equal(future.status, 'approved', 'Alocação futura não deveria ser finalizada')
    assert.equal(count, 0, 'Nenhuma alocação deveria ter sido finalizada')
  })

  test('DEVE finalizar alocação cujo endTime já passou', async ({ assert }) => {
    const { user, machine } = await createUserAndMachine('finexp2')

    // Alocação aprovada que terminou 1 hora atrás — DEVE ser finalizada
    const expired = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 3 }),
      endTime: DateTime.now().minus({ hours: 1 }),
      status: 'approved',
    })

    const count = await autoFinalizeExpired()

    await expired.refresh()
    assert.equal(expired.status, 'finished', 'Alocação expirada deveria ser finalizada')
    assert.equal(count, 1)
  })

  test('deve finalizar SOMENTE alocações expiradas, não futuras', async ({ assert }) => {
    const { user, machine } = await createUserAndMachine('finexp3')

    // Expirada (endTime -1h)
    const expired = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ hours: 4 }),
      endTime: DateTime.now().minus({ hours: 1 }),
      status: 'approved',
    })

    // Futura (endTime +3h) — NÃO deve ser afetada
    const future = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().plus({ hours: 1 }),
      endTime: DateTime.now().plus({ hours: 3 }),
      status: 'approved',
    })

    const count = await autoFinalizeExpired()

    await expired.refresh()
    await future.refresh()

    assert.equal(expired.status, 'finished')
    assert.equal(future.status, 'approved', 'Alocação futura NÃO deve ser alterada')
    assert.equal(count, 1, 'Somente 1 alocação deveria ser finalizada')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Bug 2: pruneAllocations — formato de data incompatível com SQLite
// ─────────────────────────────────────────────────────────────────────────
test.group('Bug: prune — comparação de datas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('pruneAllocations NÃO deve remover alocações recentes', async ({ client, assert }) => {
    const { user, machine } = await createUserAndMachine('prune1')

    // Alocação que terminou ontem — recente, NÃO deve ser removida se "before" é 1 semana atrás
    const recent = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ days: 1, hours: 3 }),
      endTime: DateTime.now().minus({ days: 1 }),
      status: 'finished',
    })

    const before = DateTime.now().minus({ weeks: 1 }).toISO()

    const response = await client
      .delete('/api/v1/system/prune/allocations')
      .loginAs(user)
      .json({ before })

    response.assertStatus(200)

    // Verificar que NOSSA alocação recente ainda existe (pode ter removido seeded data antiga)
    const check = await Allocation.find(recent.id)
    assert.isNotNull(check, 'Alocação recente deve continuar existindo')
  })

  test('pruneAllocations DEVE remover alocações antigas', async ({ client, assert }) => {
    const { user, machine } = await createUserAndMachine('prune2')

    // Alocação antiga (2 meses atrás)
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ months: 2, hours: 3 }),
      endTime: DateTime.now().minus({ months: 2 }),
      status: 'finished',
    })

    // "before" = 1 mês atrás → alocação de 2 meses deve ser removida
    const before = DateTime.now().minus({ months: 1 }).toISO()

    const response = await client
      .delete('/api/v1/system/prune/allocations')
      .loginAs(user)
      .json({ before })

    response.assertStatus(200)
    assert.equal(response.body().deleted, 1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Bug 3: Frontend envia data sem timezone (NewAllocationModal)
// ─────────────────────────────────────────────────────────────────────────
test.group('Bug: data sem timezone do frontend', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('servidor com TZ=UTC trata data sem offset como UTC (frontend deve converter)', async ({
    client,
    assert,
  }) => {
    const { user, machine } = await createUserAndMachine('tzfront1')

    // Frontend CORRIGIDO: toLocalIso("2026-06-15", "14:30") no browser UTC-3
    // → new Date("2026-06-15T14:30:00").toISOString() → "2026-06-15T17:30:00.000Z"
    const withTz = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: '2026-06-15T17:30:00.000Z',
      endTime: '2026-06-15T19:30:00.000Z',
    })
    withTz.assertStatus(201)

    const { user: user2, machine: machine2 } = await createUserAndMachine('tzfront2')

    // Se o front NÃO converte e envia bare string, servidor trata como UTC
    // Isso significa: 14:30 vira 14:30 UTC (3h antes do esperado pelo user UTC-3)
    const withoutTz = await client.post('/api/v1/allocations').loginAs(user2).json({
      machineId: machine2.id,
      startTime: '2026-06-15T14:30:00',
      endTime: '2026-06-15T16:30:00',
    })
    withoutTz.assertStatus(201)

    const start1 = DateTime.fromISO(withTz.body().startTime).toUTC()
    const start2 = DateTime.fromISO(withoutTz.body().startTime).toUTC()

    // Comportamento correto do servidor: bare string = UTC
    // start1 = 17:30 UTC (frontend converteu 14:30 -03:00 → 17:30 Z)
    // start2 = 14:30 UTC (bare string tratada como UTC — front DEVE ter convertido!)
    assert.equal(start1.hour, 17, 'Com TZ explícito: 17:30 UTC')
    assert.equal(start2.hour, 14, 'Sem TZ: servidor trata como 14:30 UTC')
    assert.notEqual(
      start1.hour,
      start2.hour,
      'Horários DEVEM divergir quando front não converte — por isso o fix no NewAllocationModal'
    )
  })
})
