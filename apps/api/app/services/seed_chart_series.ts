/**
 * Gera chart_series (wire ×10) para seed — buckets alinhados à grade do resumo.
 * Métricas opcionais (I/O, rede) podem ser omitidas em parte dos pontos.
 */
export type ChartSeriesWirePoint = {
  timestamp: string
  cpuUsage: number
  cpuTemp: number
  gpuUsage: number
  gpuTemp: number
  gpuPowerWatts?: number
  ramTotalGb: number
  ramUsedGb: number
  swapTotalGb?: number
  swapUsedGb?: number
  vramTotalGb?: number
  vramUsedGb?: number
  moboTemperature?: number
  diskReadMbps?: number
  diskWriteMbps?: number
  downloadMbps?: number
  uploadMbps?: number
}

export function generateChartSeriesWire(
  startMs: number,
  endMs: number,
  options: {
    pointCount?: number
    /** Passo mínimo entre pontos (default 5 min = intervalo máx. de captura). */
    minStepMs?: number
    includeDiskIo?: boolean
    includeNetwork?: boolean
    gpuIntensity?: number
  } = {}
): ChartSeriesWirePoint[] {
  const {
    pointCount = 36,
    minStepMs = 300_000,
    includeDiskIo = true,
    includeNetwork = false,
    gpuIntensity = 0.7,
  } = options

  const duration = Math.max(endMs - startMs, minStepMs)
  const stepMs = Math.max(minStepMs, Math.floor(duration / Math.max(pointCount - 1, 1)))
  const points: ChartSeriesWirePoint[] = []

  for (let i = 0; i < pointCount; i++) {
    const ts = Math.min(startMs + i * stepMs, endMs)
    const wave = Math.sin(i * 0.45) * 0.2 + 0.5
    const cpu = Math.round((0.35 + wave * 0.45) * 1000)
    const gpu = Math.round((0.2 + wave * gpuIntensity) * 1000)
    const ramTotal = 2560
    const ramUsed = Math.round((0.4 + wave * 0.35) * ramTotal)
    const vramTotal = 240
    const vramUsed = Math.round((0.3 + wave * 0.55) * vramTotal)

    const point: ChartSeriesWirePoint = {
      timestamp: new Date(ts).toISOString(),
      cpuUsage: cpu,
      cpuTemp: Math.round(450 + wave * 280),
      gpuUsage: gpu,
      gpuTemp: Math.round(400 + wave * 320),
      gpuPowerWatts: Math.round(180 + wave * 220),
      ramTotalGb: ramTotal,
      ramUsedGb: ramUsed,
      swapTotalGb: 320,
      swapUsedGb: i % 8 === 0 ? Math.round(40 + wave * 80) : 0,
      vramTotalGb: vramTotal,
      vramUsedGb: vramUsed,
      moboTemperature: Math.round(380 + wave * 120),
    }

    if (includeDiskIo && i % 3 === 0) {
      point.diskReadMbps = Math.round(200 + wave * 800)
      point.diskWriteMbps = Math.round(100 + wave * 400)
    }

    if (includeNetwork && i % 5 === 0) {
      point.downloadMbps = Math.round(20 + wave * 100)
      point.uploadMbps = Math.round(5 + wave * 30)
    }

    points.push(point)
  }

  return points
}

type RawTelemetrySeed = {
  allocationId: number
  timestamp: string
  cpuUsage: number
  cpuTemp: number
  gpuUsage: number
  gpuTemp: number
  gpuPowerWatts?: number
  vramTotalGb?: number
  vramUsedGb?: number
  ramTotalGb?: number
  ramUsedGb?: number
  swapTotalGb?: number
  swapUsedGb?: number
  moboTemperature?: number
  diskReadMbps?: number
  diskWriteMbps?: number
  downloadMbps?: number
  uploadMbps?: number
}

/**
 * Popula telemetrias brutas simulando captura periódica (para testar POST /summary).
 */
export function generateRawTelemetriesWire(
  allocationId: number,
  startMs: number,
  endMs: number,
  intervalMs: number,
  options: { gpuIntensity?: number; includeDiskIo?: boolean } = {}
): RawTelemetrySeed[] {
  const { gpuIntensity = 0.65, includeDiskIo = true } = options
  const records: RawTelemetrySeed[] = []
  let tick = 0

  for (let ts = startMs; ts <= endMs; ts += intervalMs) {
    const wave = Math.sin(tick * 0.18) * 0.22 + 0.52
    const ramTotal = 2560
    const vramTotal = 240

    const row: RawTelemetrySeed = {
      allocationId,
      timestamp: new Date(ts).toISOString(),
      cpuUsage: Math.round((0.3 + wave * 0.55) * 1000),
      cpuTemp: Math.round(420 + wave * 320),
      gpuUsage: Math.round((0.15 + wave * gpuIntensity) * 1000),
      gpuTemp: Math.round(380 + wave * 340),
      gpuPowerWatts: Math.round(120 + wave * 280),
      ramTotalGb: ramTotal,
      ramUsedGb: Math.round((0.35 + wave * 0.4) * ramTotal),
      swapTotalGb: 320,
      swapUsedGb: tick % 20 === 0 ? Math.round(30 + wave * 60) : 0,
      vramTotalGb: vramTotal,
      vramUsedGb: Math.round((0.25 + wave * 0.5) * vramTotal),
      moboTemperature: Math.round(360 + wave * 140),
    }

    if (includeDiskIo && tick % 4 === 0) {
      row.diskReadMbps = Math.round(150 + wave * 600)
      row.diskWriteMbps = Math.round(80 + wave * 350)
    }

    records.push(row)
    tick++
  }

  return records
}

/** Insert em chunks (SQLite). */
export async function createTelemetriesInChunks(
  createMany: (rows: RawTelemetrySeed[]) => Promise<unknown>,
  rows: RawTelemetrySeed[],
  chunkSize = 200
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await createMany(rows.slice(i, i + chunkSize))
  }
}
