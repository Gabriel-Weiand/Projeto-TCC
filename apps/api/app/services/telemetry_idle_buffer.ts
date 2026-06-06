import type { TelemetryPayload } from '#services/telemetry_buffer'
import {
  aggregateSamplesToMinuteBucket,
  compressPointsToBuckets,
  downsampleToBuckets,
  parseTimestampMs,
  type ChartSeriesPoint,
} from '#services/telemetry_downsample'

const ONE_MINUTE_MS = 60_000
const TEN_MINUTES_MS = 600_000
/** Série exibida no front — janela 24 h @ 15 min/ponto (~96 pts). */
export const IDLE_CHART_BUCKET_MS = 900_000
const ONE_HOUR_MS = 60 * 60 * 1000
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS

export interface IdleBufferEntry {
  timestamp: string
  resolutionMs: typeof ONE_MINUTE_MS | typeof TEN_MINUTES_MS
  metrics: TelemetryPayload
  sampleCount: number
}

interface MachineIdleState {
  /** Última hora — buckets de 1 min ou amostras nativas (≥ 60s). */
  highRes: IdleBufferEntry[]
  /** 1h–24h — buckets de 10 min. */
  lowRes: IdleBufferEntry[]
  /** Acumulador para intervalo < 60s dentro do minuto corrente. */
  pendingMinuteSamples: ChartSeriesPoint[]
  pendingMinuteKey: number | null
}

function sampleToPayload(sample: ChartSeriesPoint): TelemetryPayload {
  return {
    allocationId: 0,
    timestamp: sample.timestamp,
    cpuUsage: sample.cpuUsage ?? 0,
    cpuTemp: sample.cpuTemp ?? 0,
    cpuFreqMhz: sample.cpuFreqMhz ?? null,
    gpuUsage: sample.gpuUsage ?? 0,
    gpuTemp: sample.gpuTemp ?? 0,
    gpuPowerWatts: sample.gpuPowerWatts ?? null,
    vramTotalGb: sample.vramTotalGb ?? null,
    vramUsedGb: sample.vramUsedGb ?? null,
    ramTotalGb: sample.ramTotalGb ?? null,
    ramUsedGb: sample.ramUsedGb ?? null,
    swapTotalGb: sample.swapTotalGb ?? null,
    swapUsedGb: sample.swapUsedGb ?? null,
    disks: null,
    diskReadMbps: sample.diskReadMbps ?? null,
    diskWriteMbps: sample.diskWriteMbps ?? null,
    downloadMbps: sample.downloadMbps ?? null,
    uploadMbps: sample.uploadMbps ?? null,
    moboTemperature: sample.moboTemperature ?? null,
    activeUsers: null,
  }
}

function payloadToSample(payload: TelemetryPayload): ChartSeriesPoint {
  return {
    timestamp: payload.timestamp,
    cpuUsage: payload.cpuUsage,
    cpuTemp: payload.cpuTemp,
    cpuFreqMhz: payload.cpuFreqMhz ?? undefined,
    gpuUsage: payload.gpuUsage,
    gpuTemp: payload.gpuTemp,
    gpuPowerWatts: payload.gpuPowerWatts ?? undefined,
    vramTotalGb: payload.vramTotalGb ?? undefined,
    vramUsedGb: payload.vramUsedGb ?? undefined,
    ramTotalGb: payload.ramTotalGb ?? undefined,
    ramUsedGb: payload.ramUsedGb ?? undefined,
    swapTotalGb: payload.swapTotalGb ?? undefined,
    swapUsedGb: payload.swapUsedGb ?? undefined,
    diskReadMbps: payload.diskReadMbps ?? undefined,
    diskWriteMbps: payload.diskWriteMbps ?? undefined,
    downloadMbps: payload.downloadMbps ?? undefined,
    uploadMbps: payload.uploadMbps ?? undefined,
    moboTemperature: payload.moboTemperature ?? undefined,
  }
}

function entryToSample(entry: IdleBufferEntry): ChartSeriesPoint {
  return payloadToSample(entry.metrics)
}

class TelemetryIdleBuffer {
  private machines = new Map<number, MachineIdleState>()

  private getOrCreate(machineId: number): MachineIdleState {
    let state = this.machines.get(machineId)
    if (!state) {
      state = {
        highRes: [],
        lowRes: [],
        pendingMinuteSamples: [],
        pendingMinuteKey: null,
      }
      this.machines.set(machineId, state)
    }
    return state
  }

  ingest(machineId: number, sample: TelemetryPayload, intervalSeconds: number): void {
    const state = this.getOrCreate(machineId)
    const sampleMs = parseTimestampMs(sample.timestamp)

    if (intervalSeconds < 60) {
      this.ingestSubMinute(state, sample, sampleMs)
    } else {
      this.flushPendingMinute(state)
      state.highRes.push({
        timestamp: sample.timestamp,
        resolutionMs: ONE_MINUTE_MS,
        metrics: { ...sample, allocationId: 0 },
        sampleCount: 1,
      })
    }

    this.compact(machineId, state)
  }

  private ingestSubMinute(
    state: MachineIdleState,
    sample: TelemetryPayload,
    sampleMs: number
  ): void {
    const minuteKey = Math.floor(sampleMs / ONE_MINUTE_MS) * ONE_MINUTE_MS

    if (state.pendingMinuteKey !== null && state.pendingMinuteKey !== minuteKey) {
      this.flushPendingMinute(state)
    }

    state.pendingMinuteKey = minuteKey
    state.pendingMinuteSamples.push(payloadToSample(sample))
  }

  private flushPendingMinute(state: MachineIdleState): void {
    if (state.pendingMinuteSamples.length === 0) {
      state.pendingMinuteKey = null
      return
    }

    const bucket = aggregateSamplesToMinuteBucket(state.pendingMinuteSamples)
    const sampleCount = state.pendingMinuteSamples.length
    state.pendingMinuteSamples = []
    state.pendingMinuteKey = null

    if (!bucket) return

    state.highRes.push({
      timestamp: bucket.timestamp,
      resolutionMs: ONE_MINUTE_MS,
      metrics: sampleToPayload(bucket),
      sampleCount,
    })
  }

  private compact(_machineId: number, state: MachineIdleState): void {
    const now = Date.now()
    const oneHourAgo = now - ONE_HOUR_MS
    const twentyFourHoursAgo = now - TWENTY_FOUR_HOURS_MS

    const toKeep: IdleBufferEntry[] = []
    const toCompress: IdleBufferEntry[] = []

    for (const entry of state.highRes) {
      if (parseTimestampMs(entry.timestamp) >= oneHourAgo) {
        toKeep.push(entry)
      } else {
        toCompress.push(entry)
      }
    }

    state.highRes = toKeep

    if (toCompress.length > 0) {
      const compressSamples = toCompress.map(entryToSample)
      const rangeStart = parseTimestampMs(compressSamples[0].timestamp)
      const rangeEnd = oneHourAgo
      const compressed = compressPointsToBuckets(
        compressSamples,
        TEN_MINUTES_MS,
        Math.floor(rangeStart / TEN_MINUTES_MS) * TEN_MINUTES_MS,
        rangeEnd
      )

      this.mergeLowRes(state, compressed, toCompress.reduce((s, e) => s + e.sampleCount, 0))
    }

    state.lowRes = state.lowRes.filter(
      (entry) => parseTimestampMs(entry.timestamp) >= twentyFourHoursAgo
    )
  }

  private mergeLowRes(
    state: MachineIdleState,
    points: ChartSeriesPoint[],
    defaultSampleCount: number
  ): void {
    const byKey = new Map<number, IdleBufferEntry>()
    for (const entry of state.lowRes) {
      byKey.set(parseTimestampMs(entry.timestamp), entry)
    }

    for (const point of points) {
      const key = parseTimestampMs(point.timestamp)
      const existing = byKey.get(key)
      if (existing) {
        const merged = compressPointsToBuckets(
          [entryToSample(existing), point],
          TEN_MINUTES_MS,
          key,
          key + TEN_MINUTES_MS
        )
        if (merged.length > 0) {
          byKey.set(key, {
            timestamp: merged[0].timestamp,
            resolutionMs: TEN_MINUTES_MS,
            metrics: sampleToPayload(merged[0]),
            sampleCount: existing.sampleCount + defaultSampleCount,
          })
        }
      } else {
        byKey.set(key, {
          timestamp: point.timestamp,
          resolutionMs: TEN_MINUTES_MS,
          metrics: sampleToPayload(point),
          sampleCount: defaultSampleCount,
        })
      }
    }

    state.lowRes = [...byKey.values()].sort(
      (a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp)
    )
  }

  getHistory(machineId: number): IdleBufferEntry[] {
    const state = this.machines.get(machineId)
    if (!state) return []

    this.flushPendingMinute(state)
    this.compact(machineId, state)

    return [...state.lowRes, ...state.highRes].sort(
      (a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp)
    )
  }

  /**
   * Série para gráfico 24 h — buckets fixos de 15 min (TWA sobre buffer 1 min + 10 min).
   */
  getChartSeries(machineId: number): ChartSeriesPoint[] {
    const entries = this.getHistory(machineId)
    if (entries.length === 0) return []

    const now = Date.now()
    const rangeEndMs = now
    const rangeStartMs = now - TWENTY_FOUR_HOURS_MS
    const alignedStart =
      Math.floor(rangeStartMs / IDLE_CHART_BUCKET_MS) * IDLE_CHART_BUCKET_MS

    const samples = entries
      .filter((e) => parseTimestampMs(e.timestamp) >= alignedStart)
      .map(entryToSample)

    if (samples.length === 0) return []

    return downsampleToBuckets(samples, IDLE_CHART_BUCKET_MS, alignedStart, rangeEndMs)
  }

  getMeta(machineId: number) {
    const points = this.getHistory(machineId)
    const chartSeries = this.getChartSeries(machineId)
    const lastBufferTs =
      points.length > 0 ? points[points.length - 1]!.timestamp : null
    const lastChartTs =
      chartSeries.length > 0 ? chartSeries[chartSeries.length - 1]!.timestamp : null
    return {
      retentionHours: 24,
      recentResolutionMinutes: 1,
      olderResolutionMinutes: 10,
      pointCount: points.length,
      chartBucketMinutes: IDLE_CHART_BUCKET_MS / 60_000,
      chartPointCount: chartSeries.length,
      lastBufferTimestamp: lastBufferTs,
      lastChartTimestamp: lastChartTs,
    }
  }

  getLatestEntry(machineId: number): IdleBufferEntry | null {
    const history = this.getHistory(machineId)
    return history.length > 0 ? history[history.length - 1]! : null
  }

  clearMachine(machineId: number): void {
    this.machines.delete(machineId)
  }

  reset(): void {
    this.machines.clear()
  }
}

export const idleTelemetryBuffer = new TelemetryIdleBuffer()
