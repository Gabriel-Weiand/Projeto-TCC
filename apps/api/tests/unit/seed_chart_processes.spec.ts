import { test } from '@japa/runner'
import {
  generateProcessSnapshotsWire,
  generateRawTelemetriesWire,
} from '#services/dev/seed_chart_series'

test.group('seed_chart_series processes', () => {
  test('generateProcessSnapshotsWire retorna top com métricas GPU em carga alta', ({ assert }) => {
    const level = { cpu: 0.72, gpu: 0.92, ram: 0.78, diskIo: true }
    const procs = generateProcessSnapshotsWire(
      level,
      { hasGpu: true, ramTotalGbWire: 960, vramTotalGbWire: 480 },
      'training_burst',
      5
    )

    assert.lengthOf(procs, 5)
    assert.isAbove(procs[0].cpuPercent, procs[1].cpuPercent)
    assert.exists(procs[0].vramMb)
    assert.exists(procs[0].gpuUse)
  })

  test('generateRawTelemetriesWire inclui processes quando solicitado', ({ assert }) => {
    const rows = generateRawTelemetriesWire(1, 0, 120_000, 30_000, {
      hasGpu: true,
      includeProcessCapture: true,
      processTopX: 6,
    })

    assert.isAtLeast(rows.length, 3)
    const withProcs = rows.filter((r) => r.processes && r.processes.length > 0)
    assert.isAbove(withProcs.length, 0)
  })

  test('generateProcessSnapshotsWire gera até 100 processos sintéticos', ({ assert }) => {
    const level = { cpu: 0.72, gpu: 0.92, ram: 0.78, diskIo: true }
    const procs = generateProcessSnapshotsWire(
      level,
      { hasGpu: true, ramTotalGbWire: 320, vramTotalGbWire: 480 },
      'training_burst',
      100
    )

    assert.lengthOf(procs, 100)
    assert.equal(new Set(procs.map((p) => p.pid)).size, 100)
  })
})
