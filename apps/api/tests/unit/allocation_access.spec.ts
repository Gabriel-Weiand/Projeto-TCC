import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import {
  allocationNeedsProvisioning,
  resolveAccessPhase,
} from '#services/allocation/access'

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

test.group('resolveAccessPhase — sem janela pré-alocação', () => {
  const now = DateTime.utc()

  test('antes do startTime retorna none (sem SFTP antecipado)', ({ assert }) => {
    const allocation = alloc(
      1,
      now.plus({ minutes: 10 }),
      now.plus({ hours: 2 })
    )
    assert.equal(resolveAccessPhase(allocation, now), 'none')
    assert.isFalse(allocationNeedsProvisioning(allocation, now))
  })

  test('durante sessão retorna active', ({ assert }) => {
    const allocation = alloc(1, now.minus({ minutes: 5 }), now.plus({ hours: 1 }))
    assert.equal(resolveAccessPhase(allocation, now), 'active')
  })
})
