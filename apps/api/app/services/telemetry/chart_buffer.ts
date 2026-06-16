import type { TelemetryPayload } from '#services/telemetry/buffer'
import {
  downsampleToBuckets,
  parseTimestampMs,
  TELEMETRY_NUMERIC_KEYS,
  type ChartSeriesPoint,
} from '#services/telemetry/downsample'

/** Série exibida no front — janela 24 h @ 15 min/ponto (~96 pts). */
export const CHART_BUCKET_MS = 900_000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export interface ChartBufferEntry {
  timestamp: string
  resolutionMs: typeof CHART_BUCKET_MS
  metrics: TelemetryPayload
  sampleCount: number
}

interface StoredChartPoint {
  point: ChartSeriesPoint
  sampleCount: number
}

interface MachineChartState {
  /** Início da janela de 15 min aberta (ms UTC). */
  pendingBucketStartMs: number | null
  /** Amostras na precisão do agente dentro da janela aberta. */
  pendingSamples: ChartSeriesPoint[]
  /** Intervalo do agente (s) — usado no preview TWA da janela aberta. */
  pendingIntervalSeconds: number
  /** Pontos @ 15 min já fechados (TWA). */
  chartSeries: StoredChartPoint[]
}

function payloadToChartSample(raw: TelemetryPayload): ChartSeriesPoint {
  const sample: ChartSeriesPoint = { timestamp: raw.timestamp }
  for (const key of TELEMETRY_NUMERIC_KEYS) {
    const val = raw[key]
    if (typeof val === 'number') {
      sample[key] = val
    }
  }
  return sample
}

function sampleToPayload(sample: ChartSeriesPoint): TelemetryPayload {
  return {
    allocationId: 0,
    timestamp: sample.timestamp,
    cpuUsage: sample.cpuUsage ?? null,
    cpuTemp: sample.cpuTemp ?? null,
    cpuFreqMhz: sample.cpuFreqMhz ?? null,
    gpuUsage: sample.gpuUsage ?? null,
    gpuTemp: sample.gpuTemp ?? null,
    gpuPowerWatts: sample.gpuPowerWatts ?? null,
    vramTotalGb: sample.vramTotalGb ?? null,
    vramUsedGb: sample.vramUsedGb ?? null,
    ramTotalGb: sample.ramTotalGb ?? null,
    ramUsedGb: sample.ramUsedGb ?? null,
    swapTotalGb: sample.swapTotalGb ?? null,
    swapUsedGb: sample.swapUsedGb ?? null,
    diskReadMbps: sample.diskReadMbps ?? null,
    diskWriteMbps: sample.diskWriteMbps ?? null,
    downloadMbps: sample.downloadMbps ?? null,
    uploadMbps: sample.uploadMbps ?? null,
    moboTemperature: sample.moboTemperature ?? null,
    disks: null,
    activeUsers: null,
    processes: null,
  }
}

function chartBucketStartMs(sampleMs: number): number {
  return Math.floor(sampleMs / CHART_BUCKET_MS) * CHART_BUCKET_MS
}

class TelemetryChartBuffer {
  private machines = new Map<number, MachineChartState>()

  private getOrCreate(machineId: number): MachineChartState {
    let state = this.machines.get(machineId)
    if (!state) {
      state = {
        pendingBucketStartMs: null,
        pendingSamples: [],
        pendingIntervalSeconds: 60,
        chartSeries: [],
      }
      this.machines.set(machineId, state)
    }
    return state
  }

  /**
   * Acumula amostra na janela de 15 min aberta; ao cruzar bucket, TWA → chartSeries.
   */
  ingest(machineId: number, sample: TelemetryPayload, intervalSeconds: number): void {
    const state = this.getOrCreate(machineId)
    if (intervalSeconds > 0) {
      state.pendingIntervalSeconds = intervalSeconds
    }
    const chartSample = payloadToChartSample(sample)
    const sampleMs = parseTimestampMs(chartSample.timestamp)
    const bucketStart = chartBucketStartMs(sampleMs)

    if (
      state.pendingBucketStartMs !== null &&
      bucketStart !== state.pendingBucketStartMs
    ) {
      this.flushPendingBucket(state)
    }

    if (state.pendingBucketStartMs === null) {
      state.pendingBucketStartMs = bucketStart
    }

    state.pendingSamples.push(chartSample)
    this.purgeOldChartSeries(state)
  }

  private flushPendingBucket(state: MachineChartState): void {
    if (state.pendingSamples.length === 0 || state.pendingBucketStartMs === null) {
      state.pendingSamples = []
      state.pendingBucketStartMs = null
      return
    }

    const bucketStart = state.pendingBucketStartMs
    const bucketEnd = bucketStart + CHART_BUCKET_MS
    const sampleCount = state.pendingSamples.length
    const points = downsampleToBuckets(
      state.pendingSamples,
      CHART_BUCKET_MS,
      bucketStart,
      bucketEnd
    )

    state.pendingSamples = []
    state.pendingBucketStartMs = null

    if (points.length === 0) return

    this.upsertChartPoint(state, points[0]!, sampleCount)
  }

  private upsertChartPoint(
    state: MachineChartState,
    point: ChartSeriesPoint,
    sampleCount: number
  ): void {
    const key = parseTimestampMs(point.timestamp)
    const idx = state.chartSeries.findIndex((e) => parseTimestampMs(e.point.timestamp) === key)
    if (idx >= 0) {
      state.chartSeries[idx] = { point, sampleCount }
    } else {
      state.chartSeries.push({ point, sampleCount })
      state.chartSeries.sort(
        (a, b) => parseTimestampMs(a.point.timestamp) - parseTimestampMs(b.point.timestamp)
      )
    }
  }

  private purgeOldChartSeries(state: MachineChartState): void {
    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS
    state.chartSeries = state.chartSeries.filter(
      (entry) => parseTimestampMs(entry.point.timestamp) >= cutoff
    )
  }

  private buildPendingPreview(state: MachineChartState): ChartSeriesPoint | null {
    if (state.pendingSamples.length === 0 || state.pendingBucketStartMs === null) {
      return null
    }

    const bucketStart = state.pendingBucketStartMs
    const bucketEnd = bucketStart + CHART_BUCKET_MS
    const lastSampleMs = parseTimestampMs(
      state.pendingSamples[state.pendingSamples.length - 1]!.timestamp
    )
    const intervalMs = Math.max(1, state.pendingIntervalSeconds) * 1000
    const rangeEnd = Math.min(bucketEnd, lastSampleMs + intervalMs)
    if (rangeEnd <= bucketStart) return null

    const points = downsampleToBuckets(
      state.pendingSamples,
      CHART_BUCKET_MS,
      bucketStart,
      rangeEnd
    )
    return points[0] ?? null
  }

  /** Pontos fechados @ 15 min (sem janela aberta). */
  getClosedChartSeries(machineId: number): ChartSeriesPoint[] {
    const state = this.machines.get(machineId)
    if (!state) return []
    return state.chartSeries.map((e) => ({ ...e.point }))
  }

  /**
   * Série para gráfico 24 h — pontos fechados + preview da janela aberta (se houver).
   */
  getChartSeries(machineId: number): ChartSeriesPoint[] {
    const state = this.machines.get(machineId)
    if (!state) return []

    const closed = state.chartSeries.map((e) => ({ ...e.point }))
    const preview = this.buildPendingPreview(state)
    if (!preview) return closed

    const previewKey = parseTimestampMs(preview.timestamp)
    const closedIdx = closed.findIndex((p) => parseTimestampMs(p.timestamp) === previewKey)
    if (closedIdx >= 0) {
      const merged = [...closed]
      merged[closedIdx] = preview
      return merged
    }

    return [...closed, preview]
  }

  /** Entradas fechadas @ 15 min (alias estruturado de `chartSeries`). */
  getHistory(machineId: number): ChartBufferEntry[] {
    const state = this.machines.get(machineId)
    if (!state) return []

    return state.chartSeries.map((entry) => ({
      timestamp: entry.point.timestamp,
      resolutionMs: CHART_BUCKET_MS,
      metrics: sampleToPayload(entry.point),
      sampleCount: entry.sampleCount,
    }))
  }

  getMeta(machineId: number) {
    const state = this.machines.get(machineId)
    const closed = state?.chartSeries ?? []
    const preview = state ? this.buildPendingPreview(state) : null
    const chartSeries = preview
      ? [...closed.map((e) => e.point), preview]
      : closed.map((e) => e.point)

    const lastPendingTs =
      state && state.pendingSamples.length > 0
        ? state.pendingSamples[state.pendingSamples.length - 1]!.timestamp
        : null
    const lastClosedTs =
      closed.length > 0 ? closed[closed.length - 1]!.point.timestamp : null

    return {
      retentionHours: 24,
      recentResolutionMinutes: CHART_BUCKET_MS / 60_000,
      olderResolutionMinutes: CHART_BUCKET_MS / 60_000,
      pointCount: closed.length,
      chartBucketMinutes: CHART_BUCKET_MS / 60_000,
      chartPointCount: chartSeries.length,
      pendingSampleCount: state?.pendingSamples.length ?? 0,
      lastBufferTimestamp: lastPendingTs ?? lastClosedTs,
      lastChartTimestamp:
        chartSeries.length > 0 ? chartSeries[chartSeries.length - 1]!.timestamp : null,
    }
  }

  getLatestEntry(machineId: number): ChartBufferEntry | null {
    const state = this.machines.get(machineId)
    if (!state) return null

    if (state.pendingSamples.length > 0) {
      const last = state.pendingSamples[state.pendingSamples.length - 1]!
      return {
        timestamp: last.timestamp,
        resolutionMs: CHART_BUCKET_MS,
        metrics: sampleToPayload(last),
        sampleCount: 1,
      }
    }

    const lastStored = state.chartSeries[state.chartSeries.length - 1]
    if (!lastStored) return null

    return {
      timestamp: lastStored.point.timestamp,
      resolutionMs: CHART_BUCKET_MS,
      metrics: sampleToPayload(lastStored.point),
      sampleCount: lastStored.sampleCount,
    }
  }

  clearMachine(machineId: number): void {
    this.machines.delete(machineId)
  }

  reset(): void {
    this.machines.clear()
  }
}

export const chartTelemetryBuffer = new TelemetryChartBuffer()
