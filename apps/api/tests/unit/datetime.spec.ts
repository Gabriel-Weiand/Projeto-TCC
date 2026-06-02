import { test } from '@japa/runner'
import { parseUtcFromIso } from '#utils/datetime'

test.group('parseUtcFromIso', () => {
  test('ISO com Z mantém instante UTC', ({ assert }) => {
    const dt = parseUtcFromIso('2026-06-15T17:30:00.000Z')
    assert.equal(dt.hour, 17)
    assert.equal(dt.minute, 30)
  })

  test('string sem offset é UTC (não fuso do processo)', ({ assert }) => {
    const dt = parseUtcFromIso('2026-06-15T14:30:00')
    assert.equal(dt.hour, 14)
    assert.equal(dt.minute, 30)
  })

  test('offset -03:00 normaliza para UTC', ({ assert }) => {
    const dt = parseUtcFromIso('2026-06-15T14:00:00.000-03:00')
    assert.equal(dt.hour, 17)
  })
})
