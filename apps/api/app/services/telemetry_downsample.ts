import type { TelemetryPayload } from '#services/telemetry_buffer'
import { TELEMETRY_INTERVAL_MAX } from '#services/telemetry_presets'

/** Métricas numéricas agregáveis por TWA (wire format ×10). */
export const TELEMETRY_NUMERIC_KEYS = [
  'cpuUsage',
  'cpuTemp',
  'cpuFreqMhz',
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
] as const

export type TelemetryNumericKey = (typeof TELEMETRY_NUMERIC_KEYS)[number]

export type TelemetrySample = Pick<TelemetryPayload, TelemetryNumericKey | 'timestamp'> & {
  timestamp: string
}

export type ChartSeriesPoint = TelemetrySample

type TwaAccumulator = {
  weightedSum: number
  totalWeight: number
}

type MetricAccumulators = Partial<Record<TelemetryNumericKey, TwaAccumulator>>

function parseTimestampMs(timestamp: string): number {
  return new Date(timestamp).getTime()
}

function emptyMetricAccumulators(): MetricAccumulators {
  return {}
}

function addTwaSample(
  acc: MetricAccumulators,
  sample: TelemetrySample,
  weightMs: number
): void {
  if (weightMs <= 0) return

  for (const key of TELEMETRY_NUMERIC_KEYS) {
    const val = sample[key]
    if (typeof val !== 'number') continue

    const bucket = acc[key] ?? { weightedSum: 0, totalWeight: 0 }
    bucket.weightedSum += val * weightMs
    bucket.totalWeight += weightMs
    acc[key] = bucket
  }
}

function finalizeTwa(acc: MetricAccumulators): Partial<Record<TelemetryNumericKey, number>> {
  const out: Partial<Record<TelemetryNumericKey, number>> = {}
  for (const key of TELEMETRY_NUMERIC_KEYS) {
    const bucket = acc[key]
    if (!bucket || bucket.totalWeight <= 0) continue
    out[key] = Math.round(bucket.weightedSum / bucket.totalWeight)
  }
  return out
}

function mergeTwaAccumulators(target: MetricAccumulators, source: MetricAccumulators): void {
  for (const key of TELEMETRY_NUMERIC_KEYS) {
    const src = source[key]
    if (!src) continue
    const dst = target[key] ?? { weightedSum: 0, totalWeight: 0 }
    dst.weightedSum += src.weightedSum
    dst.totalWeight += src.totalWeight
    target[key] = dst
  }
}

/**
 * Agrega amostras em buckets fixos usando TWA.
 * Buckets sem cobertura são omitidos (evita pontos 0/null espúrios).
 */
export function downsampleToBuckets(
  samples: TelemetrySample[],
  bucketMs: number,
  rangeStartMs: number,
  rangeEndMs: number
): ChartSeriesPoint[] {
  if (samples.length === 0 || rangeEndMs <= rangeStartMs || bucketMs <= 0) {
    return []
  }

  const sorted = [...samples].sort(
    (a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp)
  )

  const bucketCount = Math.ceil((rangeEndMs - rangeStartMs) / bucketMs)
  const bucketAccs: MetricAccumulators[] = Array.from({ length: bucketCount }, () =>
    emptyMetricAccumulators()
  )

  for (let i = 0; i < sorted.length; i++) {
    const rawStart = parseTimestampMs(sorted[i].timestamp)
    if (rawStart >= rangeEndMs) continue

    const segmentStart = Math.max(rawStart, rangeStartMs)
    let segmentEnd =
      i < sorted.length - 1
        ? parseTimestampMs(sorted[i + 1].timestamp)
        : Math.min(rawStart + bucketMs, rangeEndMs)
    segmentEnd = Math.min(segmentEnd, rangeEndMs)

    if (segmentEnd <= segmentStart) continue

    for (let b = 0; b < bucketCount; b++) {
      const bucketStart = rangeStartMs + b * bucketMs
      const bucketEnd = Math.min(bucketStart + bucketMs, rangeEndMs)
      const overlapStart = Math.max(segmentStart, bucketStart)
      const overlapEnd = Math.min(segmentEnd, bucketEnd)
      const overlap = overlapEnd - overlapStart
      if (overlap <= 0) continue

      addTwaSample(bucketAccs[b], sorted[i], overlap)
    }
  }

  const points: ChartSeriesPoint[] = []
  for (let b = 0; b < bucketCount; b++) {
    const metrics = finalizeTwa(bucketAccs[b])
    const hasAnyMetric = TELEMETRY_NUMERIC_KEYS.some((k) => metrics[k] !== undefined)
    if (!hasAnyMetric) continue

    points.push({
      timestamp: new Date(rangeStartMs + b * bucketMs).toISOString(),
      ...metrics,
    } as ChartSeriesPoint)
  }

  return points
}

/**
 * Agrega amostras de alta resolução (< 60s) em um bucket de 1 minuto (TWA).
 */
export function aggregateSamplesToMinuteBucket(samples: TelemetrySample[]): ChartSeriesPoint | null {
  if (samples.length === 0) return null

  const sorted = [...samples].sort(
    (a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp)
  )

  const bucketStartMs =
    Math.floor(parseTimestampMs(sorted[0].timestamp) / 60_000) * 60_000
  const bucketEndMs = bucketStartMs + 60_000

  const acc = emptyMetricAccumulators()
  for (let i = 0; i < sorted.length; i++) {
    const segmentStart = parseTimestampMs(sorted[i].timestamp)
    const segmentEnd =
      i < sorted.length - 1
        ? parseTimestampMs(sorted[i + 1].timestamp)
        : bucketEndMs

    const weight = Math.max(0, segmentEnd - segmentStart)
    addTwaSample(acc, sorted[i], weight)
  }

  const metrics = finalizeTwa(acc)
  const hasAnyMetric = TELEMETRY_NUMERIC_KEYS.some((k) => metrics[k] !== undefined)
  if (!hasAnyMetric) return null

  return {
    timestamp: new Date(bucketStartMs).toISOString(),
    ...metrics,
  } as ChartSeriesPoint
}

/**
 * Combina múltiplos pontos (ex.: vários buckets de 1 min) em buckets maiores.
 */
export function compressPointsToBuckets(
  points: ChartSeriesPoint[],
  bucketMs: number,
  rangeStartMs: number,
  rangeEndMs: number
): ChartSeriesPoint[] {
  return downsampleToBuckets(points, bucketMs, rangeStartMs, rangeEndMs)
}

export { mergeTwaAccumulators, addTwaSample, finalizeTwa, parseTimestampMs }

/** Grade fina para sessões curtas / alta densidade de brutas (passos de 1 min). */
export const CHART_FINE_BUCKET_STEP_MS = 60_000

/** Menor bucket fino (2 min) antes de subir para a grade grossa. */
export const CHART_FINE_BUCKET_MS = 120_000

/** Grade grossa = múltiplos do intervalo máximo de captura (5 min). */
export const CHART_COARSE_BUCKET_MS = TELEMETRY_INTERVAL_MAX * 1000

/** @deprecated Prefer CHART_COARSE_BUCKET_MS */
export const CHART_MIN_BUCKET_MS = CHART_COARSE_BUCKET_MS

/** Máximo de pontos no gráfico final (sem zoom no front). */
export const CHART_MAX_POINTS = 100

/**
 * Calcula largura de bucket para caber a sessão em ~maxPoints pontos.
 * - Sessões curtas: passos de 1 min (mín. 1 min) quando alvo < 2 min.
 * - Sessões médias: bucket = intervalo máx. de captura (5 min).
 * - Sessões longas: múltiplos de 5 min mais próximos de ~100 pontos.
 */
export function resolveChartBucketMs(
  durationMs: number,
  maxPoints: number = CHART_MAX_POINTS
): number {
  if (durationMs <= 0 || maxPoints <= 0) return CHART_COARSE_BUCKET_MS

  const targetMs = durationMs / maxPoints

  if (targetMs < CHART_FINE_BUCKET_MS) {
    return Math.max(
      CHART_FINE_BUCKET_STEP_MS,
      Math.ceil(targetMs / CHART_FINE_BUCKET_STEP_MS) * CHART_FINE_BUCKET_STEP_MS
    )
  }

  if (targetMs <= CHART_COARSE_BUCKET_MS) {
    return CHART_COARSE_BUCKET_MS
  }

  const baseMult = Math.max(1, Math.floor(targetMs / CHART_COARSE_BUCKET_MS))
  let bestBucket = baseMult * CHART_COARSE_BUCKET_MS
  let bestDiff = Infinity

  for (let mult = baseMult; mult <= baseMult + 2; mult++) {
    const bucket = mult * CHART_COARSE_BUCKET_MS
    const points = Math.ceil(durationMs / bucket)
    const diff = Math.abs(points - maxPoints)
    if (diff < bestDiff) {
      bestDiff = diff
      bestBucket = bucket
    }
  }

  return bestBucket
}

export function chartBucketMinutes(bucketMs: number): number {
  return Math.max(1, Math.round(bucketMs / 60_000))
}
