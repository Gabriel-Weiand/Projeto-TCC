import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import {
  allowHomeMigrationForUser,
  allocationNeedsProvisioning,
  resolveAccessPhase,
  type LabAccessConfig,
} from '#services/allocation/access'
import { getLabAccessConfig } from '#services/lab/config'

function alloc(
  id: number,
  start: DateTime,
  end: DateTime,
  status: Allocation['status'] = 'approved'
) {
  const row = new Allocation()
  row.id = id
  row.startTime = start
  row.endTime = end
  row.status = status
  return row
}

test.group('allowHomeMigrationForUser', () => {
  const now = DateTime.utc()

  test('permite migração quando outra alocação só está em no_key', ({ assert }) => {
    const oldAlloc = alloc(
      1,
      now.minus({ days: 4 }),
      now.minus({ days: 3 })
    )
    assert.equal(resolveAccessPhase(oldAlloc, now), 'no_key')

    const newAlloc = alloc(2, now.minus({ hours: 1 }), now.plus({ hours: 2 }))
    assert.equal(resolveAccessPhase(newAlloc, now), 'active')

    assert.isTrue(
      allowHomeMigrationForUser(
        [oldAlloc, newAlloc],
        newAlloc,
        '/scratch/lab.aluno',
        now
      )
    )
  })

  test('bloqueia migração quando outra alocação ainda está em post_sftp', ({ assert }) => {
    const oldAlloc = alloc(
      1,
      now.minus({ days: 1 }),
      now.minus({ hours: 3 })
    )
    assert.equal(resolveAccessPhase(oldAlloc, now), 'post_sftp')

    const newAlloc = alloc(2, now.minus({ hours: 1 }), now.plus({ hours: 2 }))

    assert.isFalse(
      allowHomeMigrationForUser(
        [oldAlloc, newAlloc],
        newAlloc,
        '/scratch/lab.aluno',
        now
      )
    )
  })

  test('false sem homeDirectory', ({ assert }) => {
    const a = alloc(1, now.minus({ hours: 2 }), now.plus({ hours: 2 }))
    assert.isFalse(allowHomeMigrationForUser([a], a, null, now))
  })

  test('bloqueia migração com access customizado quando reserva antiga ainda está em post_sftp', ({
    assert,
  }) => {
    const end = now.minus({ days: 8 })
    const oldAlloc = alloc(1, end.minus({ days: 1 }), end)
    const newAlloc = alloc(2, now.minus({ hours: 1 }), now.plus({ hours: 2 }))

    const customAccess: LabAccessConfig = {
      ...getLabAccessConfig(),
      deleteUserDays: 14,
      postSftpMinutes: 12_000,
      graceMinutes: 10,
    }

    assert.equal(resolveAccessPhase(oldAlloc, now, customAccess), 'post_sftp')
    assert.isFalse(allocationNeedsProvisioning(oldAlloc, now, getLabAccessConfig()))
    assert.isTrue(allocationNeedsProvisioning(oldAlloc, now, customAccess))

    assert.isFalse(
      allowHomeMigrationForUser(
        [oldAlloc, newAlloc],
        newAlloc,
        '/scratch/lab.aluno',
        now,
        customAccess
      )
    )
  })
})
