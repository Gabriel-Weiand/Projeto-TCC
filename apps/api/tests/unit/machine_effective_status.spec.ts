import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Machine from '#models/machine'
import {
  isHeartbeatStale,
  resolveEffectiveMachineStatus,
} from '#services/machine/effective_status'

test.group('machine_effective_status', () => {
  test('heartbeat stale após 25 h UTC', ({ assert }) => {
    const machine = new Machine()
    machine.status = 'available'
    machine.lastSeenAt = DateTime.utc().minus({ hours: 25 })
    const now = DateTime.utc()

    assert.isTrue(isHeartbeatStale(machine, now))
    assert.equal(
      resolveEffectiveMachineStatus(machine, new Set(), now),
      'offline',
    )
  })

  test('heartbeat recente mantém máquina available', ({ assert }) => {
    const machine = new Machine()
    machine.status = 'available'
    machine.lastSeenAt = DateTime.utc().minus({ hours: 1 })
    const now = DateTime.utc()

    assert.isFalse(isHeartbeatStale(machine, now))
    assert.equal(
      resolveEffectiveMachineStatus(machine, new Set(), now),
      'available',
    )
  })
})
