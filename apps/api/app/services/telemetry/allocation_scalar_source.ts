import type Allocation from '#models/allocation'
import type Telemetry from '#models/telemetry'
import {
  IDLE_CHART_BUCKET_MS,
  idleTelemetryBuffer,
} from '#services/telemetry/idle_buffer'
import { parseTimestampMs, type ChartSeriesPoint } from '#services/telemetry/downsample'

/** Converte payload do buffer ocioso em linha compatível com `calculateMetrics`. */
function payloadToScalarRow(
  allocationId: number,
  timestamp: string,
  metrics: Record<string, unknown>
): Telemetry {
  return {
    allocationId,
    timestamp,
    cpuUsage: (metrics.cpuUsage as number | null | undefined) ?? null,
    cpuTemp: (metrics.cpuTemp as number | null | undefined) ?? null,
    cpuFreqMhz: (metrics.cpuFreqMhz as number | null | undefined) ?? null,
    gpuUsage: (metrics.gpuUsage as number | null | undefined) ?? null,
    gpuTemp: (metrics.gpuTemp as number | null | undefined) ?? null,
    gpuPowerWatts: (metrics.gpuPowerWatts as number | null | undefined) ?? null,
    vramTotalGb: (metrics.vramTotalGb as number | null | undefined) ?? null,
    vramUsedGb: (metrics.vramUsedGb as number | null | undefined) ?? null,
    ramTotalGb: (metrics.ramTotalGb as number | null | undefined) ?? null,
    ramUsedGb: (metrics.ramUsedGb as number | null | undefined) ?? null,
    swapTotalGb: (metrics.swapTotalGb as number | null | undefined) ?? null,
    swapUsedGb: (metrics.swapUsedGb as number | null | undefined) ?? null,
    diskReadMbps: (metrics.diskReadMbps as number | null | undefined) ?? null,
    diskWriteMbps: (metrics.diskWriteMbps as number | null | undefined) ?? null,
    downloadMbps: (metrics.downloadMbps as number | null | undefined) ?? null,
    uploadMbps: (metrics.uploadMbps as number | null | undefined) ?? null,
    moboTemperature: (metrics.moboTemperature as number | null | undefined) ?? null,
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
  const bucketEnd = bucketStart + IDLE_CHART_BUCKET_MS
  return bucketEnd > startMs && bucketStart <= endMs
}

/**
 * Pontos TWA @ 15 min do buffer ocioso dentro da janela da alocação.
 * Substitui telemetria bruta escalar no resumo de sessão.
 */
export function scalarSamplesFromIdleChart(
  machineId: number,
  allocation: Allocation
): Telemetry[] {
  const closed = idleTelemetryBuffer
    .getHistory(machineId)
    .filter((entry) => bucketOverlapsAllocation(entry.timestamp, allocation))
    .map((entry) =>
      payloadToScalarRow(allocation.id, entry.timestamp, entry.metrics as Record<string, unknown>)
    )

  const preview = idleTelemetryBuffer.getChartSeries(machineId).find((point) =>
    bucketOverlapsAllocation(point.timestamp, allocation)
  )

  if (!preview) return closed

  const previewRow = payloadToScalarRow(
    allocation.id,
    preview.timestamp,
    preview as unknown as Record<string, unknown>
  )
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

export function chartSeriesFromIdleBuffer(
  machineId: number,
  allocation: Allocation
): { points: ChartSeriesPoint[]; bucketMs: number } {
  const points = idleTelemetryBuffer
    .getChartSeries(machineId)
    .filter((point) => bucketOverlapsAllocation(point.timestamp, allocation))
  return { points, bucketMs: IDLE_CHART_BUCKET_MS }
}

export function shouldPersistAllocationSample(
  sample: { processes?: unknown[] | null }
): boolean {
  return Array.isArray(sample.processes) && sample.processes.length > 0
}
