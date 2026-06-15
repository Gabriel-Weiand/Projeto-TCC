import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import { buildProcessSummary, mergeProcessSnapshotsInSample } from '#services/telemetry/process_summary'

test.group('process_summary', () => {
  test('mergeProcessSnapshotsInSample soma duplicatas pid+nome na mesma amostra', ({ assert }) => {
    const merged = mergeProcessSnapshotsInSample([
      { pid: 1, name: 'python', username: 'lab.alice', cpuPercent: 100, ramMb: 200 },
      { pid: 1, name: 'python', username: 'lab.alice', cpuPercent: 150, ramMb: 100, vramMb: 50 },
    ])

    assert.lengthOf(merged, 1)
    assert.equal(merged[0].cpuPercent, 250)
    assert.equal(merged[0].ramMb, 300)
    assert.equal(merged[0].vramMb, 50)
  })

  test('buildProcessSummary agrupa por pid+nome com média TWA e pico', async ({ assert }) => {
    const allocation = {
      startTime: DateTime.fromISO('2026-01-01T10:00:00.000Z'),
      endTime: DateTime.fromISO('2026-01-01T10:02:00.000Z'),
    } as Allocation

    const telemetries = [
      {
        timestamp: '2026-01-01T10:00:00.000Z',
        processes: [
          { pid: 10, name: 'train', username: 'lab.bob', cpuPercent: 100, ramMb: 1000 },
          { pid: 20, name: 'train', username: 'lab.bob', cpuPercent: 200, ramMb: 2000 },
        ],
      },
      {
        timestamp: '2026-01-01T10:01:00.000Z',
        processes: [
          { pid: 10, name: 'train', username: 'lab.bob', cpuPercent: 300, ramMb: 1500 },
        ],
      },
    ] as any[]

    const summary = buildProcessSummary(telemetries, allocation)
    assert.lengthOf(summary, 2)

    const p10 = summary.find((p) => p.pid === 10)!
    const p20 = summary.find((p) => p.pid === 20)!

    assert.exists(p10)
    assert.exists(p20)
    assert.equal(p10.sampleCount, 2)
    assert.equal(p20.sampleCount, 1)
    assert.equal(p10.maxCpuPercent, 300)
    assert.equal(p10.maxRamMb, 1500)
    assert.isAtMost(p10.avgCpuPercent, p10.maxCpuPercent)
    assert.isAtMost(p20.avgCpuPercent, p20.maxCpuPercent)
  })
})
