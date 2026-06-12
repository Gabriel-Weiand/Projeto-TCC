import {
  DEFAULT_LAB_TELEMETRY_PRESETS,
  FULL_TELEMETRY_SET,
  TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
  type TelemetrySetConfig,
} from '#services/telemetry_presets'
import {
  applyTelemetrySetToSeedRow,
  generateProcessSnapshotsWire,
  generateRawTelemetriesWire,
  seedActiveUsersWire,
  seedDisksInfoWire,
  type RawTelemetrySeed,
} from '#services/seed_chart_series'
import { buildProcessSummary } from '#services/process_summary'
import {
  buildAllocationChartSeries,
} from '#services/allocation_summarizer'
import {
  chartBucketMinutes,
  resolveChartBucketMs,
} from '#services/telemetry_downsample'
import type Allocation from '#models/allocation'
import type Telemetry from '#models/telemetry'
import { DateTime } from 'luxon'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** Overhead aproximado por linha SQLite (header + índices + PK). */
const SQLITE_ROW_OVERHEAD_BYTES = 56

export type TelemetryStorageScenario = {
  id: string
  label: string
  intervalSeconds: number
  durationHours: number
  telemetrySet: TelemetrySetConfig
  processTopX: number
  hasGpu?: boolean
}

export type TelemetryStorageEstimate = {
  scenario: TelemetryStorageScenario
  sampleCount: number
  rowBytes: number
  jsonPayloadBytes: number
  processesBytes: number
  disksInfoBytes: number
  activeUsersBytes: number
  totalBytes: number
  totalMb: number
  totalGb: number
}

export type TelemetryRowBreakdown = {
  label: string
  rowBytes: number
  deltaBytes: number
  scalarsBytes: number
  disksInfoBytes: number
  activeUsersBytes: number
  processesBytes: number
  telemetrySet: TelemetrySetConfig
  processTopX: number
}

export type SummaryStorageEstimate = {
  scenario: TelemetryStorageScenario
  chartPointCount: number
  chartBucketMinutes: number
  chartSeriesBytes: number
  processSummaryEntryCount: number
  processSummaryBytes: number
  scalarMetricsBytes: number
  sqliteRowOverheadBytes: number
  totalBytes: number
  totalKb: number
}

export type FiveMinuteStorageReport = {
  intervalSeconds: number
  durationHours: number
  sampleCount: number
  hardwareOnly: TelemetryStorageEstimate
  hardwareBreakdown: TelemetryRowBreakdown[]
  withProcesses: TelemetryStorageEstimate[]
  processDeltas: { topX: number; rowBytes: number; deltaFromHardware: number; total24h: number }[]
  summaries: SummaryStorageEstimate[]
}

export function telemetrySampleCount(intervalSeconds: number, durationHours: number): number {
  const interval = Math.max(1, Math.round(intervalSeconds))
  const durationSec = Math.max(0, durationHours * 3600)
  return Math.floor(durationSec / interval) + 1
}

function jsonBytes(value: unknown): number {
  if (value == null) return 0
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

/** Estima bytes de uma linha `telemetries` com base no payload persistido. */
export function estimateTelemetryRowBytes(row: RawTelemetrySeed): number {
  let bytes = SQLITE_ROW_OVERHEAD_BYTES
  bytes += Buffer.byteLength(String(row.timestamp), 'utf8')

  const numericFields: (keyof RawTelemetrySeed)[] = [
    'cpuUsage',
    'cpuTemp',
    'gpuUsage',
    'gpuTemp',
    'gpuPowerWatts',
    'vramTotalGb',
    'vramUsedGb',
    'ramTotalGb',
    'ramUsedGb',
    'swapTotalGb',
    'swapUsedGb',
    'diskReadMbps',
    'diskWriteMbps',
    'downloadMbps',
    'uploadMbps',
    'moboTemperature',
  ]

  for (const key of numericFields) {
    if (row[key] != null) bytes += 4
  }

  bytes += jsonBytes(row.disksInfo)
  bytes += jsonBytes(row.activeUsers)
  bytes += jsonBytes(row.processes)

  return bytes
}

function countScalarBytes(row: RawTelemetrySeed): number {
  let bytes = Buffer.byteLength(String(row.timestamp), 'utf8')
  const numericFields: (keyof RawTelemetrySeed)[] = [
    'cpuUsage',
    'cpuTemp',
    'gpuUsage',
    'gpuTemp',
    'gpuPowerWatts',
    'vramTotalGb',
    'vramUsedGb',
    'ramTotalGb',
    'ramUsedGb',
    'swapTotalGb',
    'swapUsedGb',
    'diskReadMbps',
    'diskWriteMbps',
    'downloadMbps',
    'uploadMbps',
    'moboTemperature',
  ]
  for (const key of numericFields) {
    if (row[key] != null) bytes += 4
  }
  return bytes
}

export function estimateTelemetryRowBreakdown(row: RawTelemetrySeed): Omit<TelemetryRowBreakdown, 'label' | 'deltaBytes' | 'telemetrySet' | 'processTopX'> {
  const disksInfoBytes = jsonBytes(row.disksInfo)
  const activeUsersBytes = jsonBytes(row.activeUsers)
  const processesBytes = jsonBytes(row.processes)
  const scalarsBytes = countScalarBytes(row)
  const rowBytes = SQLITE_ROW_OVERHEAD_BYTES + scalarsBytes + disksInfoBytes + activeUsersBytes + processesBytes
  return { rowBytes, scalarsBytes, disksInfoBytes, activeUsersBytes, processesBytes }
}

function representativeGpuRow(
  telemetrySet: TelemetrySetConfig,
  processTopX: number,
  hasGpu = true
): RawTelemetrySeed {
  const level = { cpu: 0.72, gpu: 0.92, ram: 0.78, diskIo: true }
  const hw = { hasGpu, ramTotalGbWire: 320, vramTotalGbWire: hasGpu ? 480 : null }

  const base: RawTelemetrySeed & {
    disksInfo?: Record<string, unknown>[] | null
    activeUsers?: Record<string, unknown>[] | null
  } = {
    allocationId: 1,
    timestamp: new Date(0).toISOString(),
    cpuUsage: 720,
    cpuTemp: 690,
    gpuUsage: hasGpu ? 920 : 0,
    gpuTemp: hasGpu ? 760 : 0,
    gpuPowerWatts: hasGpu ? 390 : undefined,
    ramTotalGb: 320,
    ramUsedGb: 250,
    swapTotalGb: 160,
    swapUsedGb: 0,
    vramTotalGb: hasGpu ? 480 : undefined,
    vramUsedGb: hasGpu ? 442 : undefined,
    moboTemperature: 475,
    diskReadMbps: 1980,
    diskWriteMbps: 830,
    downloadMbps: 121,
    uploadMbps: 36,
    disksInfo: seedDisksInfoWire(level),
    activeUsers: seedActiveUsersWire(),
    processes:
      processTopX > 0 && telemetrySet.processCapture
        ? generateProcessSnapshotsWire(level, hw, 'training_burst', processTopX)
        : undefined,
  }

  return applyTelemetrySetToSeedRow(base, telemetrySet, level)
}

export function estimateTelemetryStorage(
  scenario: TelemetryStorageScenario
): TelemetryStorageEstimate {
  const row = representativeGpuRow(
    scenario.telemetrySet,
    scenario.processTopX,
    scenario.hasGpu ?? true
  )
  const rowBytes = estimateTelemetryRowBytes(row)
  const sampleCount = telemetrySampleCount(scenario.intervalSeconds, scenario.durationHours)
  const totalBytes = rowBytes * sampleCount

  return {
    scenario,
    sampleCount,
    rowBytes,
    jsonPayloadBytes: jsonBytes(row),
    processesBytes: jsonBytes(row.processes),
    disksInfoBytes: jsonBytes(row.disksInfo),
    activeUsersBytes: jsonBytes(row.activeUsers),
    totalBytes,
    totalMb: totalBytes / (1024 * 1024),
    totalGb: totalBytes / (1024 * 1024 * 1024),
  }
}

const CUSTOM_FULL_SET: TelemetrySetConfig = {
  ...FULL_TELEMETRY_SET,
  processCapture: true,
}

/** Todas as métricas de hardware, sem captura de processos. */
export const FULL_HARDWARE_SET: TelemetrySetConfig = {
  ...FULL_TELEMETRY_SET,
  processCapture: false,
}

export const FIVE_MINUTE_INTERVAL_SECONDS = 300
export const DEFAULT_ESTIMATE_DURATION_HOURS = 24

/** Cenários pedidos: eco / fast / custom (todas métricas) @ 2s · alocação 24h. */
export function buildHardwareRowBreakdown(hasGpu = true): TelemetryRowBreakdown[] {
  const layers: { label: string; set: TelemetrySetConfig }[] = [
    {
      label: 'CPU + RAM/Swap (obrigatório)',
      set: {
        cpu: true,
        gpu: false,
        ramAndSwap: true,
        disk: false,
        networkIO: false,
        temperatures: false,
        activeUsers: false,
        processCapture: false,
      },
    },
    {
      label: '+ GPU · VRAM · power',
      set: {
        cpu: true,
        gpu: true,
        ramAndSwap: true,
        disk: false,
        networkIO: false,
        temperatures: false,
        activeUsers: false,
        processCapture: false,
      },
    },
    {
      label: '+ Disco (throughput + disksInfo)',
      set: {
        cpu: true,
        gpu: true,
        ramAndSwap: true,
        disk: true,
        networkIO: false,
        temperatures: false,
        activeUsers: false,
        processCapture: false,
      },
    },
    {
      label: '+ Rede (download/upload)',
      set: {
        cpu: true,
        gpu: true,
        ramAndSwap: true,
        disk: true,
        networkIO: true,
        temperatures: false,
        activeUsers: false,
        processCapture: false,
      },
    },
    {
      label: '+ Temperaturas (CPU + placa-mãe)',
      set: {
        cpu: true,
        gpu: true,
        ramAndSwap: true,
        disk: true,
        networkIO: true,
        temperatures: true,
        activeUsers: false,
        processCapture: false,
      },
    },
    {
      label: '+ Usuários ativos (activeUsers)',
      set: { ...FULL_HARDWARE_SET },
    },
  ]

  let prevBytes = 0
  return layers.map((layer) => {
    const row = representativeGpuRow(layer.set, 0, hasGpu)
    const parts = estimateTelemetryRowBreakdown(row)
    const deltaBytes = parts.rowBytes - prevBytes
    prevBytes = parts.rowBytes
    return {
      label: layer.label,
      deltaBytes,
      telemetrySet: layer.set,
      processTopX: 0,
      ...parts,
    }
  })
}

function mockAllocation24h(): Allocation {
  return {
    startTime: DateTime.fromMillis(0, { zone: 'utc' }),
    endTime: DateTime.fromMillis(DAY_MS, { zone: 'utc' }),
  } as Allocation
}

/** Estima tamanho de uma linha `allocation_metrics` após "Gerar resumo". */
export function estimateSummaryStorage(
  scenario: TelemetryStorageScenario
): SummaryStorageEstimate {
  const allocation = mockAllocation24h()
  const bucketMs = resolveChartBucketMs(DAY_MS)
  const hasGpu = scenario.hasGpu ?? true

  const rows = generateRawTelemetriesWire(1, 0, DAY_MS, scenario.intervalSeconds * 1000, {
    profile: 'training_burst',
    hasGpu,
    ramTotalGbWire: 320,
    vramTotalGbWire: 480,
    telemetrySet: scenario.telemetrySet,
    processTopX: scenario.processTopX,
  })
  const telemetries = rows as unknown as Telemetry[]
  const { points } = buildAllocationChartSeries(telemetries, allocation)
  const chartPointCount = points.length
  const chartSeriesBytes = jsonBytes(points)

  let processSummaryEntryCount = 0
  let processSummaryBytes = 0
  if (scenario.telemetrySet.processCapture && scenario.processTopX > 0) {
    const summary = buildProcessSummary(telemetries, allocation)
    processSummaryEntryCount = summary.length
    processSummaryBytes = jsonBytes(summary)
  }

  const scalarMetricsBytes = 30 * 4
  const sqliteRowOverheadBytes = 64
  const totalBytes =
    sqliteRowOverheadBytes + scalarMetricsBytes + chartSeriesBytes + processSummaryBytes

  return {
    scenario,
    chartPointCount,
    chartBucketMinutes: chartBucketMinutes(bucketMs),
    chartSeriesBytes,
    processSummaryEntryCount,
    processSummaryBytes,
    scalarMetricsBytes,
    sqliteRowOverheadBytes,
    totalBytes,
    totalKb: totalBytes / 1024,
  }
}

export function build24hFiveMinuteScenarios(
  durationHours = DEFAULT_ESTIMATE_DURATION_HOURS
): TelemetryStorageScenario[] {
  const base = {
    intervalSeconds: FIVE_MINUTE_INTERVAL_SECONDS,
    durationHours,
    telemetrySet: FULL_HARDWARE_SET,
    hasGpu: true,
  }

  return [
    {
      id: 'hw-5m-24h',
      label: 'Hardware completo · sem processos · 5 min · 24h',
      ...base,
      processTopX: 0,
    },
    ...([10, 50, TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX] as const).map((topX) => ({
      id: `full-5m-24h-proc-${topX}`,
      label: `Tudo capturado · top ${topX} proc. · 5 min · 24h`,
      intervalSeconds: FIVE_MINUTE_INTERVAL_SECONDS,
      durationHours,
      telemetrySet: { ...CUSTOM_FULL_SET, processCapture: true },
      processTopX: topX,
      hasGpu: true,
    })),
  ]
}

export function buildFiveMinuteStorageReport(
  durationHours = DEFAULT_ESTIMATE_DURATION_HOURS
): FiveMinuteStorageReport {
  const intervalSeconds = FIVE_MINUTE_INTERVAL_SECONDS
  const sampleCount = telemetrySampleCount(intervalSeconds, durationHours)
  const hardwareOnly = estimateTelemetryStorage({
    id: 'hw-5m-24h',
    label: 'Hardware completo · sem processos · 5 min · 24h',
    intervalSeconds,
    durationHours,
    telemetrySet: FULL_HARDWARE_SET,
    processTopX: 0,
  })
  const hardwareBreakdown = buildHardwareRowBreakdown(true)
  const scenarios = build24hFiveMinuteScenarios(durationHours)
  const withProcesses = scenarios.slice(1).map(estimateTelemetryStorage)
  const summaries = scenarios.map(estimateSummaryStorage)

  const hwRowBytes = hardwareOnly.rowBytes
  const processDeltas = withProcesses.map((e) => ({
    topX: e.scenario.processTopX,
    rowBytes: e.rowBytes,
    deltaFromHardware: e.rowBytes - hwRowBytes,
    total24h: e.totalBytes,
  }))

  return {
    intervalSeconds,
    durationHours,
    sampleCount,
    hardwareOnly,
    hardwareBreakdown,
    withProcesses,
    processDeltas,
    summaries,
  }
}

export function formatHardwareBreakdownTable(breakdown: TelemetryRowBreakdown[]): string {
  const header =
    '| Camada | +Δ linha | Linha acum. | disksInfo | activeUsers | processos |\n' +
    '|--------|----------|-------------|-----------|-------------|-----------|'

  const rows = breakdown.map((b) =>
    `| ${b.label} | +${formatBytes(b.deltaBytes)} | ${formatBytes(b.rowBytes)} | ${formatBytes(b.disksInfoBytes)} | ${formatBytes(b.activeUsersBytes)} | ${b.processesBytes ? formatBytes(b.processesBytes) : '—'} |`
  )

  return [header, ...rows].join('\n')
}

export function formatFiveMinuteRawTable(report: FiveMinuteStorageReport): string {
  const header =
    '| Cenário | Amostras | Linha | Δ proc. vs HW | Total 24h (bruto) |\n' +
    '|---------|----------|-------|---------------|-------------------|'

  const hw = report.hardwareOnly
  const rows = [
    `| ${hw.scenario.label} | ${hw.sampleCount.toLocaleString('pt-BR')} | ${formatBytes(hw.rowBytes)} | — | **${formatBytes(hw.totalBytes)}** |`,
    ...report.withProcesses.map((e) => {
      const delta = e.rowBytes - hw.rowBytes
      return `| ${e.scenario.label} | ${e.sampleCount.toLocaleString('pt-BR')} | ${formatBytes(e.rowBytes)} | +${formatBytes(delta)} | **${formatBytes(e.totalBytes)}** |`
    }),
  ]

  return [header, ...rows].join('\n')
}

export function formatSummaryStorageTable(summaries: SummaryStorageEstimate[]): string {
  const header =
    '| Cenário | Pontos gráfico | chartSeries | processSummary | Total resumo |\n' +
    '|---------|----------------|-------------|----------------|--------------|'

  const rows = summaries.map((s) => {
    const proc =
      s.processSummaryEntryCount > 0
        ? `${s.processSummaryEntryCount} ent. (${formatBytes(s.processSummaryBytes)})`
        : '—'
    return `| ${s.scenario.label} | ${s.chartPointCount} × ${s.chartBucketMinutes} min | ${formatBytes(s.chartSeriesBytes)} | ${proc} | **${formatBytes(s.totalBytes)}** |`
  })

  return [header, ...rows].join('\n')
}

export function formatFiveMinuteStorageReport(report: FiveMinuteStorageReport): string {
  const lines = [
    `Telemetria bruta · ${report.durationHours}h @ ${report.intervalSeconds}s (${report.sampleCount.toLocaleString('pt-BR')} amostras)`,
    '',
    'Composição da linha (hardware, sem processos):',
    formatHardwareBreakdownTable(report.hardwareBreakdown),
    '',
    'Total bruto por cenário:',
    formatFiveMinuteRawTable(report),
    '',
    'Incremento só de processos (sobre hardware completo):',
    ...report.processDeltas.map(
      (d) =>
        `- Top ${d.topX}: +${formatBytes(d.deltaFromHardware)}/amostra → +${formatBytes(d.deltaFromHardware * report.sampleCount)} em 24h (linha ${formatBytes(d.rowBytes)}, total ${formatBytes(d.total24h)})`
    ),
    '',
    `Resumo persistido (allocation_metrics) · após Gerar resumo:`,
    '',
    formatSummaryStorageTable(report.summaries),
  ]

  return lines.join('\n')
}

/** Cenários pedidos: eco / fast / custom (todas métricas) @ 2s · alocação 24h. */
export function build24hTwoSecondScenarios(): TelemetryStorageScenario[] {
  return [
    {
      id: 'eco-2s-24h',
      label: 'Eco · intervalo 2s · 24h',
      intervalSeconds: 2,
      durationHours: 24,
      telemetrySet: DEFAULT_LAB_TELEMETRY_PRESETS.eco.telemetrySet,
      processTopX: DEFAULT_LAB_TELEMETRY_PRESETS.eco.processCaptureConfig.topX,
    },
    {
      id: 'fast-2s-24h',
      label: 'Fast · intervalo 2s · 24h',
      intervalSeconds: 2,
      durationHours: 24,
      telemetrySet: DEFAULT_LAB_TELEMETRY_PRESETS.fast.telemetrySet,
      processTopX: DEFAULT_LAB_TELEMETRY_PRESETS.fast.processCaptureConfig.topX,
    },
    {
      id: 'custom-2s-24h-full',
      label: 'Custom · todas métricas · captura proc. top 10 · 2s · 24h',
      intervalSeconds: 2,
      durationHours: 24,
      telemetrySet: { ...CUSTOM_FULL_SET, processCapture: true },
      processTopX: 10,
    },
    {
      id: 'custom-2s-24h-max-proc',
      label: `Custom · todas métricas · captura proc. top ${TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX} · 2s · 24h`,
      intervalSeconds: 2,
      durationHours: 24,
      telemetrySet: { ...CUSTOM_FULL_SET, processCapture: true },
      processTopX: TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
    },
  ]
}

/** Referência com intervalos padrão eco (60s) e fast (30s) na mesma duração. */
export function buildDefaultIntervalComparison(durationHours = 24): TelemetryStorageScenario[] {
  return [
    {
      id: 'eco-60s-24h',
      label: 'Eco · intervalo padrão 60s · 24h',
      intervalSeconds: DEFAULT_LAB_TELEMETRY_PRESETS.eco.intervalSeconds,
      durationHours,
      telemetrySet: DEFAULT_LAB_TELEMETRY_PRESETS.eco.telemetrySet,
      processTopX: 0,
    },
    {
      id: 'fast-30s-24h',
      label: 'Fast · intervalo padrão 30s · 24h',
      intervalSeconds: DEFAULT_LAB_TELEMETRY_PRESETS.fast.intervalSeconds,
      durationHours,
      telemetrySet: DEFAULT_LAB_TELEMETRY_PRESETS.fast.telemetrySet,
      processTopX: 0,
    },
  ]
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

export function formatTelemetryStorageTable(estimates: TelemetryStorageEstimate[]): string {
  const header =
    '| Cenário | Amostras | Linha | Processos/amostra | Total 24h |\n' +
    '|---------|----------|-------|---------------------|-----------|'

  const rows = estimates.map((e) => {
    const proc =
      e.scenario.telemetrySet.processCapture && e.scenario.processTopX > 0
        ? `${e.scenario.processTopX} (~${formatBytes(e.processesBytes)})`
        : '—'
    return `| ${e.scenario.label} | ${e.sampleCount.toLocaleString('pt-BR')} | ${formatBytes(e.rowBytes)} | ${proc} | **${formatBytes(e.totalBytes)}** |`
  })

  return [header, ...rows].join('\n')
}

export function logTelemetryStorageReport(): void {
  const primary = build24hTwoSecondScenarios().map(estimateTelemetryStorage)
  const reference = buildDefaultIntervalComparison(24).map(estimateTelemetryStorage)
  const fiveMin = buildFiveMinuteStorageReport()

  console.log('\n📦 Estimativa de armazenamento — telemetria bruta (tabela `telemetries`)')
  console.log('   GPU RTX representativa · valores ≈ payload JSON + overhead SQLite por linha\n')
  console.log(formatTelemetryStorageTable(primary))
  console.log('\n   Referência (intervalos padrão do laboratório):\n')
  console.log(formatTelemetryStorageTable(reference))

  const eco2s = primary[0]
  const customMax = primary[3]
  console.log(
    `\n   Eco @2s vs Custom max proc: ${formatBytes(eco2s.totalBytes)} → ${formatBytes(customMax.totalBytes)} (${(customMax.totalBytes / eco2s.totalBytes).toFixed(1)}×)`
  )

  console.log('\n📦 Intervalo 5 min · 24h (hardware vs tudo + processos):\n')
  console.log(formatFiveMinuteStorageReport(fiveMin))
  console.log('')
}

/** Gera amostras reais para seed (útil em testes de volume). */
export function generateStorageScenarioSamples(
  scenario: TelemetryStorageScenario,
  allocationId: number,
  startMs: number,
  durationMs: number = DAY_MS
): RawTelemetrySeed[] {
  return generateRawTelemetriesWire(
    allocationId,
    startMs,
    startMs + durationMs,
    scenario.intervalSeconds * 1000,
    {
      profile: 'training_burst',
      hasGpu: scenario.hasGpu ?? true,
      ramTotalGbWire: 320,
      vramTotalGbWire: 480,
      includeDiskIo: scenario.telemetrySet.disk,
      telemetrySet: scenario.telemetrySet,
      processTopX: scenario.processTopX,
    }
  )
}

export { HOUR_MS, DAY_MS }
