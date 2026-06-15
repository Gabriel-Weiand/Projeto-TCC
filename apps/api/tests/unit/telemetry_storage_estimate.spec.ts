import { test } from '@japa/runner'
import {
  build24hTwoSecondScenarios,
  buildFiveMinuteStorageReport,
  estimateTelemetryStorage,
  formatTelemetryStorageTable,
  telemetrySampleCount,
  FIVE_MINUTE_INTERVAL_SECONDS,
} from '#services/telemetry/storage_estimate'
import { TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX } from '#services/telemetry/presets'

test.group('telemetry_storage_estimate', () => {
  test('24h @ 2s produz 43201 amostras', ({ assert }) => {
    assert.equal(telemetrySampleCount(2, 24), 43_201)
  })

  test('custom max processos é o maior cenário @ 2s/24h', ({ assert }) => {
    const estimates = build24hTwoSecondScenarios().map(estimateTelemetryStorage)
    const eco = estimates.find((e) => e.scenario.id === 'eco-2s-24h')!
    const customMax = estimates.find((e) => e.scenario.id === 'custom-2s-24h-max-proc')!

    assert.isAbove(customMax.totalBytes, eco.totalBytes)
    assert.equal(customMax.scenario.processTopX, TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX)
    assert.isAbove(customMax.processesBytes, eco.processesBytes)
  })

  test('formatTelemetryStorageTable inclui todos os cenários 2s/24h', ({ assert }) => {
    const table = formatTelemetryStorageTable(
      build24hTwoSecondScenarios().map(estimateTelemetryStorage)
    )
    assert.include(table, 'Eco · intervalo 2s · 24h')
    assert.include(table, 'Custom · todas métricas')
    assert.include(table, String(TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX))
  })

  test('24h @ 5min produz 289 amostras', ({ assert }) => {
    assert.equal(telemetrySampleCount(FIVE_MINUTE_INTERVAL_SECONDS, 24), 289)
  })

  test('5min hardware-only menor que full proc 100', ({ assert }) => {
    const report = buildFiveMinuteStorageReport()
    assert.isAbove(report.withProcesses[2].totalBytes, report.hardwareOnly.totalBytes)
    assert.equal(report.summaries[0].processSummaryBytes, 0)
    assert.isAbove(report.summaries[3].processSummaryBytes, 0)
  })
})
