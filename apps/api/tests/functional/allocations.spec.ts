import { test } from '@japa/runner'
import User from '#models/user'
import Allocation from '#models/allocation'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { createTestMachine } from '../helpers/test_machine.js'

test.group('Allocations', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // =========================================================================
  // CRIAÇÃO E REGRAS DE NEGÓCIO (store)
  // =========================================================================

  test('usuário deve criar uma alocação e auto-aprovar', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Teste User',
      email: 'teste@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-01', description: 'Lab', status: 'available' })

    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: DateTime.utc().plus({ hours: 1 }).toISO(), // Tudo em UTC no teste
        endTime: DateTime.utc().plus({ hours: 3 }).toISO(),
      })

    response.assertStatus(201)
    response.assertBodyContains({ status: 'approved' })
  })

  test('com LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL=true usuário cria pending', async ({
    client,
  }) => {
    const prev = process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL
    process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL = 'true'

    const user = await User.create({
      fullName: 'Pending User',
      email: 'pending@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-PEND', description: 'Lab', status: 'available' })

    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: DateTime.utc().plus({ hours: 1 }).toISO(),
        endTime: DateTime.utc().plus({ hours: 3 }).toISO(),
        status: 'approved',
      })

    if (prev !== undefined) process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL = prev
    else delete process.env.LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL

    response.assertStatus(201)
    response.assertBodyContains({ status: 'pending' })
  })

  test('NÃO deve criar alocação em máquina em manutenção', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u1@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-MANU',
      description: 'Manutenção',
      status: 'maintenance',
    })

    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: DateTime.utc().plus({ hours: 1 }).toISO(),
        endTime: DateTime.utc().plus({ hours: 2 }).toISO(),
      })

    response.assertStatus(400)
    response.assertBodyContains({ code: 'MACHINE_IN_MAINTENANCE' })
  })

  test('NÃO deve criar alocação com conflito de horário na mesma máquina', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'u2@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-01', description: 'Lab', status: 'available' })

    const baseStart = DateTime.utc().plus({ hours: 1 })
    const baseEnd = DateTime.utc().plus({ hours: 3 })

    // Cria a primeira reserva (1h às 3h)
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: baseStart,
      endTime: baseEnd,
      status: 'approved',
    })

    // Tenta criar sobreposta (1.5h às 3.5h)
    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: baseStart.plus({ minutes: 30 }).toISO(),
        endTime: baseEnd.plus({ minutes: 30 }).toISO(),
      })

    response.assertStatus(409)
    response.assertBodyContains({ code: 'ALLOCATION_CONFLICT' })
  })

  // =========================================================================
  // LISTAGENS (index e myAllocations)
  // =========================================================================

  test('usuário deve listar apenas suas próprias alocações', async ({ client, assert }) => {
    const user1 = await User.create({
      fullName: 'User 1',
      email: 'a1@teste.com',
      password: '123',
      role: 'user',
    })
    const user2 = await User.create({
      fullName: 'User 2',
      email: 'a2@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-01', description: 'Lab', status: 'available' })

    await Allocation.create({
      userId: user1.id,
      machineId: machine.id,
      startTime: DateTime.utc(),
      endTime: DateTime.utc().plus({ hours: 1 }),
    })
    await Allocation.create({
      userId: user2.id,
      machineId: machine.id,
      startTime: DateTime.utc(),
      endTime: DateTime.utc().plus({ hours: 1 }),
    })

    const response = await client.get('/api/v1/allocations/my').loginAs(user1)

    response.assertStatus(200)
    assert.equal(response.body().meta.total, 1)
  })

  // =========================================================================
  // EXTENSÃO (Grace Period)
  // =========================================================================

  test('usuário deve conseguir estender a sua própria alocação ativa', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Ext User',
      email: 'ext@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-01', description: 'Lab', status: 'available' })

    const endTime = DateTime.utc().plus({ minutes: 30 }) // Acaba daqui a 30 mins

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ minutes: 30 }),
      endTime: endTime,
      status: 'approved',
    })

    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/extend`)
      .loginAs(user)
      .json({
        additionalMinutes: 30,
      })

    response.assertStatus(200)
    await allocation.refresh()

    // O novo endTime deve ser 30 minutos maior
    const diffMins = allocation.endTime.diff(endTime, 'minutes').minutes
    assert.closeTo(diffMins, 30, 1)
  })

  test('usuário deve estender informando novo endTime', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Ext End',
      email: 'extendend@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-EXT-END',
      description: 'Lab',
      status: 'available',
    })

    const endTime = DateTime.utc().plus({ minutes: 20 })
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ minutes: 10 }),
      endTime,
      status: 'approved',
    })

    const newEnd = endTime.plus({ hours: 2 }).toISO()

    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/extend`)
      .loginAs(user)
      .json({ endTime: newEnd })

    response.assertStatus(200)
    await allocation.refresh()
    // SQLite grava segundos (sem ms)
    assert.equal(
      allocation.endTime.toUTC().toISO(),
      DateTime.fromISO(newEnd).toUTC().startOf('second').toISO()
    )
  })

  test('usuário deve estender reserva aprovada antes do início', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Ext Future',
      email: 'extfuture@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-EXT-FUT',
      description: 'Lab',
      status: 'available',
    })

    const endTime = DateTime.utc().plus({ days: 3 })
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ days: 1 }),
      endTime,
      status: 'approved',
    })

    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/extend`)
      .loginAs(user)
      .json({ additionalMinutes: 60 })

    response.assertStatus(200)
    await allocation.refresh()
    assert.closeTo(allocation.endTime.diff(endTime, 'minutes').minutes, 60, 1)
  })

  test('deve negar extensão na fase SFTP pós-sessão', async ({ client }) => {
    const user = await User.create({
      fullName: 'Teste',
      email: 't2@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-01', description: 'Lab', status: 'available' })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 2 }),
      endTime: DateTime.utc().minus({ minutes: 11 }),
      status: 'approved',
    })

    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/extend`)
      .loginAs(user)
      .json({
        additionalMinutes: 30,
      })

    response.assertStatus(400)
    response.assertBodyContains({
      message:
        'Não é possível estender nesta fase. Estenda antes do início, durante a sessão ou no grace.',
    })
  })

  test('deve negar extensão se conflitar com outra reserva', async ({ client }) => {
    const user = await User.create({
      fullName: 'Ext Conflict',
      email: 'extconf@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-01', description: 'Lab', status: 'available' })

    const endTime = DateTime.utc().plus({ minutes: 20 })

    const mine = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ minutes: 10 }),
      endTime: endTime,
      status: 'approved',
    })

    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: endTime.plus({ minutes: 15 }),
      endTime: endTime.plus({ hours: 1 }),
      status: 'approved',
    })

    const response = await client
      .post(`/api/v1/allocations/${mine.id}/extend`)
      .loginAs(user)
      .json({ additionalMinutes: 30 })

    response.assertStatus(409)
    response.assertBodyContains({ code: 'ALLOCATION_CONFLICT' })
  })

  test('deve permitir reserva após gap mínimo de 10 minutos', async ({ client }) => {
    const user = await User.create({
      fullName: 'Gap Ok',
      email: 'gapok@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({ name: 'PC-GAP', description: 'Lab', status: 'available' })

    const end = DateTime.utc().plus({ hours: 2 })
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 1 }),
      endTime: end,
      status: 'approved',
    })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: end.plus({ minutes: 10 }).toISO(),
      endTime: end.plus({ hours: 3 }).toISO(),
    })

    response.assertStatus(201)
  })

  test('deve negar reserva durante grace da alocação anterior', async ({ client }) => {
    const user = await User.create({
      fullName: 'Grace Conflict',
      email: 'grace-conflict@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-GRACE-CONF',
      description: 'Lab',
      status: 'available',
    })

    const end = DateTime.utc().minus({ minutes: 5 })
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: end.minus({ hours: 2 }),
      endTime: end,
      status: 'approved',
    })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: end.plus({ minutes: 5 }).toISO(),
      endTime: end.plus({ hours: 2 }).toISO(),
    })

    response.assertStatus(409)
    response.assertBodyContains({ code: 'ALLOCATION_CONFLICT' })
  })

  test('deve negar reserva dentro do intervalo mínimo (grace) após endTime', async ({ client }) => {
    const user = await User.create({
      fullName: 'Gap Fail',
      email: 'gapfail@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-GAP2',
      description: 'Lab',
      status: 'available',
    })

    const end = DateTime.utc().plus({ hours: 2 })
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 1 }),
      endTime: end,
      status: 'approved',
    })

    const response = await client.post('/api/v1/allocations').loginAs(user).json({
      machineId: machine.id,
      startTime: end.plus({ minutes: 5 }).toISO(),
      endTime: end.plus({ hours: 3 }).toISO(),
    })

    response.assertStatus(409)
    response.assertBodyContains({ code: 'ALLOCATION_CONFLICT' })
  })

  test('usuário deve finalizar sessão antecipada', async ({ client, assert }) => {
    const user = await User.create({
      fullName: 'Finish Early',
      email: 'finish@teste.com',
      password: '123',
      role: 'user',
      systemUsername: 'lab.finish_user',
    })
    const machine = await createTestMachine({
      name: 'PC-FIN',
      description: 'Lab',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ minutes: 30 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
    })

    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/finish`)
      .loginAs(user)

    response.assertStatus(200)
    response.assertBodyContains({ lifecycleStatus: 'finished' })
    await allocation.refresh()
    assert.equal(allocation.status, 'finished')
    assert.isTrue(allocation.endTime.toMillis() <= DateTime.utc().toMillis() + 5000)
  })

  // =========================================================================
  // SEGURANÇA BÁSICA
  // =========================================================================

  test('NÃO deve criar alocação sem autenticação', async ({ client }) => {
    const response = await client.post('/api/v1/allocations').json({
      machineId: 1,
      startTime: DateTime.utc().toISO(),
      endTime: DateTime.utc().plus({ hours: 1 }).toISO(),
    })
    response.assertStatus(401)
  })

  // =========================================================================
  test('admin deve alterar início e fim de alocação alheia com validação', async ({
    client,
    assert,
  }) => {
    const admin = await User.create({
      fullName: 'Admin Patch',
      email: 'admin.patch@teste.com',
      password: '123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'Aluno',
      email: 'aluno.patch@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-PATCH',
      description: 'Lab',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ days: 2 }),
      endTime: DateTime.utc().plus({ days: 2, hours: 2 }),
      status: 'approved',
    })

    const newStart = DateTime.utc().plus({ days: 3 }).toISO()
    const newEnd = DateTime.utc().plus({ days: 3, hours: 3 }).toISO()

    const response = await client
      .patch(`/api/v1/allocations/${allocation.id}`)
      .loginAs(admin)
      .json({ startTime: newStart, endTime: newEnd })

    response.assertStatus(200)
    await allocation.refresh()
    assert.equal(
      allocation.startTime.toUTC().toISO(),
      DateTime.fromISO(newStart).toUTC().startOf('second').toISO()
    )
    assert.equal(
      allocation.endTime.toUTC().toISO(),
      DateTime.fromISO(newEnd).toUTC().startOf('second').toISO()
    )
  })

  test('admin NÃO pode alterar horários de alocação finished', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin Fin',
      email: 'admin.fin@teste.com',
      password: '123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'Aluno Fin',
      email: 'aluno.fin@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-FIN',
      description: 'Lab',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 3 }),
      endTime: DateTime.utc().minus({ hours: 1 }),
      status: 'finished',
    })

    const response = await client
      .patch(`/api/v1/allocations/${allocation.id}`)
      .loginAs(admin)
      .json({ endTime: DateTime.utc().plus({ hours: 1 }).toISO() })

    response.assertStatus(400)
    response.assertBodyContains({ code: 'CANNOT_CHANGE_FINISHED_TIMES' })
  })

  // CANCELAMENTO E SOFT DELETE (PATCH / DELETE)
  // =========================================================================

  test('usuário deve conseguir cancelar (PATCH) a sua própria alocação', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'cancel@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-CANCEL',
      description: 'Lab',
      status: 'available',
    })
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
    })

    const response = await client
      .patch(`/api/v1/allocations/${allocation.id}`)
      .loginAs(user)
      .json({ status: 'cancelled' })

    response.assertStatus(200)
    await allocation.refresh()
    assert.equal(allocation.status, 'cancelled')
  })

  test('usuário NÃO pode cancelar após o início da alocação', async ({ client }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'cancel-late@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-CANCEL-LATE',
      description: 'Lab',
      status: 'available',
    })
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
    })

    const response = await client
      .patch(`/api/v1/allocations/${allocation.id}`)
      .loginAs(user)
      .json({ status: 'cancelled' })

    response.assertStatus(400)
    response.assertBodyContains({ code: 'CANNOT_CANCEL_AFTER_START' })
  })

  test('usuário deve fazer soft-delete (ocultar) de uma alocação terminada', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'User',
      email: 'hide@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-HIDE',
      description: 'Lab',
      status: 'available',
    })
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 2 }),
      endTime: DateTime.utc().minus({ hours: 1 }),
      status: 'finished',
    })

    const response = await client.delete(`/api/v1/allocations/${allocation.id}`).loginAs(user)

    response.assertStatus(200)
    await allocation.refresh()
    assert.isTrue(allocation.userHidden) // Oculto com sucesso
  })

  test('admin não vê alocações ocultas na lista operacional', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'adminhide@teste.com',
      password: '123',
      role: 'admin',
    })
    const user = await User.create({
      fullName: 'User',
      email: 'userhide@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-HIDE-ADM',
      description: 'Lab',
      status: 'available',
    })
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().minus({ hours: 2 }),
      endTime: DateTime.utc().minus({ hours: 1 }),
      status: 'finished',
      userHidden: true,
    })
    await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.utc().plus({ hours: 1 }),
      endTime: DateTime.utc().plus({ hours: 2 }),
      status: 'approved',
      userHidden: false,
    })

    const active = await client
      .get('/api/v1/allocations')
      .qs({ machineId: machine.id, userId: user.id })
      .loginAs(admin)
    active.assertStatus(200)
    assert.equal(active.body().meta.total, 1)
    assert.isFalse(active.body().data[0].userHidden)

    const hidden = await client
      .get('/api/v1/allocations')
      .qs({ machineId: machine.id, userId: user.id, userHidden: true })
      .loginAs(admin)
    hidden.assertStatus(200)
    assert.equal(hidden.body().meta.total, 1)
    assert.isTrue(hidden.body().data[0].userHidden)
  })

  test('admin deve listar alocações ativas no index', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'adminlist@teste.com',
      password: '123',
      role: 'admin',
    })
    const response = await client.get('/api/v1/allocations').loginAs(admin)
    response.assertStatus(200)
    assert.exists(response.body().meta.total)
  })

  test('rejeita homeMountpoint não allocatable na máquina', async ({ client }) => {
    const user = await User.create({
      fullName: 'Disk Pick',
      email: 'diskpick@teste.com',
      password: '123',
      role: 'user',
    })
    const machine = await createTestMachine({
      name: 'PC-DISK-PICK',
      description: 'Lab',
      status: 'available',
      onlyMainDisk: false,
      disks: [
        { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true, totalGb: 200 },
        { device: 'sdc1', mountpoint: '/data', role: 'user', totalGb: 500, allocatable: false },
      ],
    })

    const response = await client
      .post('/api/v1/allocations')
      .loginAs(user)
      .json({
        machineId: machine.id,
        startTime: DateTime.utc().plus({ hours: 2 }).toISO(),
        endTime: DateTime.utc().plus({ hours: 4 }).toISO(),
        homeMountpoint: '/data',
      })

    response.assertStatus(400)
    response.assertBodyContains({ code: 'INVALID_HOME_MOUNT' })
  })
})
