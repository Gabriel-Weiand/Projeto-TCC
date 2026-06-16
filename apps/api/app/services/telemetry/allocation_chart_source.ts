import type Allocation from '#models/allocation'
import type Telemetry from '#models/telemetry'
import type { TelemetryPayload } from '#services/telemetry/buffer'
import { CHART_BUCKET_MS, chartTelemetryBuffer } from '#services/telemetry/chart_buffer'
import { parseTimestampMs, type ChartSeriesPoint, type TelemetryNumericKey } from '#services/telemetry/downsample'

type ScalarMetrics = Pick<TelemetryPayload, TelemetryNumericKey> | ChartSeriesPoint

/** Converte payload do buffer de gráfico em linha compatível com `calculateMetrics`. */
function payloadToScalarRow(
  allocationId: number,
  timestamp: string,
  metrics: ScalarMetrics
): Telemetry {
  return {
    allocationId,
    timestamp,
    cpuUsage: metrics.cpuUsage ?? null,
    cpuTemp: metrics.cpuTemp ?? null,
    cpuFreqMhz: metrics.cpuFreqMhz ?? null,
    gpuUsage: metrics.gpuUsage ?? null,
    gpuTemp: metrics.gpuTemp ?? null,
    gpuPowerWatts: metrics.gpuPowerWatts ?? null,
    vramTotalGb: metrics.vramTotalGb ?? null,
    vramUsedGb: metrics.vramUsedGb ?? null,
    ramTotalGb: metrics.ramTotalGb ?? null,
    ramUsedGb: metrics.ramUsedGb ?? null,
    swapTotalGb: metrics.swapTotalGb ?? null,
    swapUsedGb: metrics.swapUsedGb ?? null,
    diskReadMbps: metrics.diskReadMbps ?? null,
    diskWriteMbps: metrics.diskWriteMbps ?? null,
    downloadMbps: metrics.downloadMbps ?? null,
    uploadMbps: metrics.uploadMbps ?? null,
    moboTemperature: metrics.moboTemperature ?? null,
    disksInfo: null,
    activeUsers: null,
    processes: null,
  } as Telemetry
}

function allocationWindowMs(allocation: Allocation) {
  return {
    startMs: allocation.startTime.toMillis(),
    endMs: allocation.endTime.toMillis(),
  }
}

function bucketOverlapsAllocation(pointTs: string, allocation: Allocation): boolean {
  const { startMs, endMs } = allocationWindowMs(allocation)
  const bucketStart = parseTimestampMs(pointTs)
  const bucketEnd = bucketStart + CHART_BUCKET_MS
  return bucketEnd > startMs && bucketStart <= endMs
}

/**
 * Pontos TWA @ 15 min do chartTelemetryBuffer dentro da janela da alocação.
 * Substitui telemetria bruta escalar no resumo de sessão.
 */
export function scalarSamplesFromChartBuffer(
  machineId: number,
  allocation: Allocation
): Telemetry[] {
  const closed = chartTelemetryBuffer
    .getHistory(machineId)
    .filter((entry) => bucketOverlapsAllocation(entry.timestamp, allocation))
    .map((entry) => payloadToScalarRow(allocation.id, entry.timestamp, entry.metrics))

  const preview = chartTelemetryBuffer.getChartSeries(machineId).find((point) =>
    bucketOverlapsAllocation(point.timestamp, allocation)
  )

  if (!preview) return closed

  const previewRow = payloadToScalarRow(allocation.id, preview.timestamp, preview)
  const previewKey = parseTimestampMs(preview.timestamp)
  const idx = closed.findIndex((row) => parseTimestampMs(row.timestamp) === previewKey)
  if (idx >= 0) {
    const merged = [...closed]
    merged[idx] = previewRow
    return merged
  }
  return [...closed, previewRow].sort(
    (a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp)
  )
}

export function chartSeriesFromChartBuffer(
  machineId: number,
  allocation: Allocation
): { points: ChartSeriesPoint[]; bucketMs: number } {
  const points = chartTelemetryBuffer
    .getChartSeries(machineId)
    .filter((point) => bucketOverlapsAllocation(point.timestamp, allocation))
  return { points, bucketMs: CHART_BUCKET_MS }
}

export function shouldPersistAllocationSample(
  sample: { processes?: unknown[] | null }
): boolean {
  return Array.isArray(sample.processes) && sample.processes.length > 0
}
