/**
 * Gera chart_series e telemetrias brutas para seed — perfis em degraus (sem senoides).
 */
export type UsageProfile =
  | 'training_burst'
  | 'inference_gaps'
  | 'cpu_batch'
  | 'io_bursts'
  | 'compile_spikes'

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

type LevelSample = {
  cpu: number
  gpu: number
  ram: number
  diskIo: boolean
}

type SeedHardware = {
  hasGpu: boolean
  ramTotalGbWire: number
  vramTotalGbWire?: number | null
}

function levelAtProgress(progress: number, profile: UsageProfile, hasGpu: boolean): LevelSample {
  const p = Math.min(1, Math.max(0, progress))

  const idle = (): LevelSample => ({ cpu: 0.06, gpu: 0, ram: 0.22, diskIo: false })
  const low = (): LevelSample => ({ cpu: 0.18, gpu: hasGpu ? 0.05 : 0, ram: 0.35, diskIo: false })
  const mid = (): LevelSample => ({ cpu: 0.48, gpu: hasGpu ? 0.55 : 0, ram: 0.58, diskIo: true })
  const high = (): LevelSample => ({ cpu: 0.72, gpu: hasGpu ? 0.92 : 0, ram: 0.78, diskIo: true })
  const cool = (): LevelSample => ({ cpu: 0.12, gpu: hasGpu ? 0.04 : 0, ram: 0.4, diskIo: false })

  switch (profile) {
    case 'training_burst':
      if (p < 0.08) return idle()
      if (p < 0.12) return { cpu: 0.35, gpu: hasGpu ? 0.28 : 0, ram: 0.32, diskIo: true }
      if (p < 0.7) return high()
      if (p < 0.78) return cool()
      if (p < 0.88) return mid()
      return idle()

    case 'inference_gaps':
      if (p < 0.1) return idle()
      if (p < 0.14) return { cpu: 0.25, gpu: hasGpu ? 0.82 : 0, ram: 0.45, diskIo: false }
      if (p < 0.22) return idle()
      if (p < 0.26) return { cpu: 0.22, gpu: hasGpu ? 0.78 : 0, ram: 0.42, diskIo: false }
      if (p < 0.34) return low()
      if (p < 0.38) return { cpu: 0.3, gpu: hasGpu ? 0.85 : 0, ram: 0.5, diskIo: false }
      if (p < 0.55) return mid()
      if (p < 0.62) return idle()
      if (p < 0.66) return high()
      return cool()

    case 'cpu_batch':
      if (p < 0.15) return idle()
      if (p < 0.2) return { cpu: 0.55, gpu: 0, ram: 0.62, diskIo: true }
      if (p < 0.45) return { cpu: 0.88, gpu: 0, ram: 0.85, diskIo: p > 0.35 && p < 0.38 }
      if (p < 0.52) return { cpu: 0.2, gpu: 0, ram: 0.48, diskIo: false }
      if (p < 0.75) return { cpu: 0.76, gpu: 0, ram: 0.8, diskIo: true }
      if (p < 0.82) return low()
      return idle()

    case 'io_bursts':
      if (p < 0.2) return low()
      if (p < 0.24) return { cpu: 0.62, gpu: hasGpu ? 0.15 : 0, ram: 0.55, diskIo: true }
      if (p < 0.35) return idle()
      if (p < 0.39) return { cpu: 0.58, gpu: hasGpu ? 0.12 : 0, ram: 0.52, diskIo: true }
      if (p < 0.6) return low()
      if (p < 0.64) return { cpu: 0.7, gpu: hasGpu ? 0.2 : 0, ram: 0.6, diskIo: true }
      return cool()

    case 'compile_spikes':
      if (p < 0.1) return idle()
      if (p < 0.14) return { cpu: 0.95, gpu: hasGpu ? 0.08 : 0, ram: 0.7, diskIo: true }
      if (p < 0.22) return low()
      if (p < 0.26) return { cpu: 0.92, gpu: hasGpu ? 0.1 : 0, ram: 0.68, diskIo: true }
      if (p < 0.4) return mid()
      if (p < 0.44) return { cpu: 0.98, gpu: hasGpu ? 0.12 : 0, ram: 0.82, diskIo: true }
      if (p < 0.55) return cool()
      if (p < 0.58) return high()
      return idle()

    default:
      return mid()
  }
}

function wirePointFromLevel(
  ts: number,
  level: LevelSample,
  hw: SeedHardware
): ChartSeriesWirePoint {
  const ramTotal = hw.ramTotalGbWire
  const vramTotal = hw.vramTotalGbWire ?? 0
  const ramUsed = Math.round(level.ram * ramTotal)
  const gpuUsage = hw.hasGpu ? Math.round(level.gpu * 1000) : 0
  const gpuTemp = hw.hasGpu ? Math.round(380 + level.gpu * 420) : 0

  const point: ChartSeriesWirePoint = {
    timestamp: new Date(ts).toISOString(),
    cpuUsage: Math.round(level.cpu * 1000),
    cpuTemp: Math.round(420 + level.cpu * 380),
    gpuUsage,
    gpuTemp,
    ramTotalGb: ramTotal,
    ramUsedGb: ramUsed,
    swapTotalGb: Math.max(160, Math.round(ramTotal * 0.25)),
    swapUsedGb: level.cpu > 0.85 ? Math.round(ramTotal * 0.08) : 0,
    moboTemperature: Math.round(360 + level.cpu * 160),
  }

  if (hw.hasGpu && vramTotal > 0) {
    point.gpuPowerWatts = Math.round(80 + level.gpu * 340)
    point.vramTotalGb = vramTotal
    point.vramUsedGb = Math.round(level.gpu * vramTotal * 0.95)
  }

  if (level.diskIo) {
    point.diskReadMbps = Math.round(400 + level.cpu * 2200)
    point.diskWriteMbps = Math.round(200 + level.cpu * 900)
  }

  return point
}

export function generateChartSeriesWire(
  startMs: number,
  endMs: number,
  options: {
    pointCount?: number
    minStepMs?: number
    includeDiskIo?: boolean
    includeNetwork?: boolean
    profile?: UsageProfile
    hasGpu?: boolean
    ramTotalGbWire?: number
    vramTotalGbWire?: number | null
  } = {}
): ChartSeriesWirePoint[] {
  const {
    pointCount = 36,
    minStepMs = 300_000,
    includeNetwork = false,
    profile = 'training_burst',
    hasGpu = true,
    ramTotalGbWire = 960,
    vramTotalGbWire = 480,
  } = options

  const hw: SeedHardware = { hasGpu, ramTotalGbWire, vramTotalGbWire }
  const duration = Math.max(endMs - startMs, minStepMs)
  const stepMs = Math.max(minStepMs, Math.floor(duration / Math.max(pointCount - 1, 1)))
  const points: ChartSeriesWirePoint[] = []

  for (let i = 0; i < pointCount; i++) {
    const ts = Math.min(startMs + i * stepMs, endMs)
    const progress = pointCount <= 1 ? 0 : i / (pointCount - 1)
    const level = levelAtProgress(progress, profile, hasGpu)
    const point = wirePointFromLevel(ts, level, hw)

    if (includeNetwork && i % 4 === 0) {
      point.downloadMbps = Math.round(15 + level.cpu * 120)
      point.uploadMbps = Math.round(4 + level.cpu * 35)
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

export function generateRawTelemetriesWire(
  allocationId: number,
  startMs: number,
  endMs: number,
  intervalMs: number,
  options: {
    profile?: UsageProfile
    hasGpu?: boolean
    ramTotalGbWire?: number
    vramTotalGbWire?: number | null
    includeDiskIo?: boolean
  } = {}
): RawTelemetrySeed[] {
  const {
    profile = 'training_burst',
    hasGpu = true,
    ramTotalGbWire = 960,
    vramTotalGbWire = 480,
    includeDiskIo = true,
  } = options

  const hw: SeedHardware = { hasGpu, ramTotalGbWire, vramTotalGbWire }
  const records: RawTelemetrySeed[] = []
  const span = Math.max(endMs - startMs, intervalMs)
  let tick = 0

  for (let ts = startMs; ts <= endMs; ts += intervalMs) {
    const progress = (ts - startMs) / span
    const level = levelAtProgress(progress, profile, hasGpu)
    if (!includeDiskIo) {
      level.diskIo = false
    }

    const point = wirePointFromLevel(ts, level, hw)
    records.push({
      allocationId,
      timestamp: point.timestamp,
      cpuUsage: point.cpuUsage,
      cpuTemp: point.cpuTemp,
      gpuUsage: point.gpuUsage,
      gpuTemp: point.gpuTemp,
      gpuPowerWatts: point.gpuPowerWatts,
      ramTotalGb: point.ramTotalGb,
      ramUsedGb: point.ramUsedGb,
      swapTotalGb: point.swapTotalGb,
      swapUsedGb: point.swapUsedGb,
      vramTotalGb: point.vramTotalGb,
      vramUsedGb: point.vramUsedGb,
      moboTemperature: point.moboTemperature,
      diskReadMbps: point.diskReadMbps,
      diskWriteMbps: point.diskWriteMbps,
    })
    tick++
    if (tick > 50_000) break
  }

  return records
}

/** Agrega médias/máximos wire a partir de uma série de chart. */
export function aggregateWireMetricsFromChart(points: ChartSeriesWirePoint[]) {
  if (points.length === 0) {
    return null
  }

  const avg = (values: number[]) =>
    Math.round(values.reduce((s, v) => s + v, 0) / values.length)
  const max = (values: number[]) => Math.max(...values)
  const nums = (pick: (p: ChartSeriesWirePoint) => number | undefined) =>
    points.map(pick).filter((v): v is number => v !== undefined && v !== null)

  const cpu = nums((p) => p.cpuUsage)
  const gpu = nums((p) => p.gpuUsage)
  const hasGpu = gpu.some((v) => v > 0)

  return {
    avgCpuUsage: avg(cpu),
    maxCpuUsage: max(cpu),
    avgCpuTemp: avg(nums((p) => p.cpuTemp)),
    maxCpuTemp: max(nums((p) => p.cpuTemp)),
    avgGpuUsage: hasGpu ? avg(gpu) : 0,
    maxGpuUsage: hasGpu ? max(gpu) : 0,
    avgGpuTemp: hasGpu ? avg(nums((p) => p.gpuTemp)) : 0,
    maxGpuTemp: hasGpu ? max(nums((p) => p.gpuTemp)) : 0,
    avgGpuPowerWatts: hasGpu ? avg(nums((p) => p.gpuPowerWatts ?? 0)) : 0,
    maxGpuPowerWatts: hasGpu ? max(nums((p) => p.gpuPowerWatts ?? 0)) : 0,
    avgVramTotalGb: hasGpu ? avg(nums((p) => p.vramTotalGb ?? 0)) : 0,
    maxVramTotalGb: hasGpu ? max(nums((p) => p.vramTotalGb ?? 0)) : 0,
    avgVramUsedGb: hasGpu ? avg(nums((p) => p.vramUsedGb ?? 0)) : 0,
    maxVramUsedGb: hasGpu ? max(nums((p) => p.vramUsedGb ?? 0)) : 0,
    avgRamUsedGb: avg(nums((p) => p.ramUsedGb)),
    maxRamUsedGb: max(nums((p) => p.ramUsedGb)),
    avgSwapUsedGb: avg(nums((p) => p.swapUsedGb ?? 0)),
    maxSwapUsedGb: max(nums((p) => p.swapUsedGb ?? 0)),
    avgDiskReadMbps: avg(nums((p) => p.diskReadMbps ?? 0)),
    maxDiskReadMbps: max(nums((p) => p.diskReadMbps ?? 0)),
    avgDiskWriteMbps: avg(nums((p) => p.diskWriteMbps ?? 0)),
    maxDiskWriteMbps: max(nums((p) => p.diskWriteMbps ?? 0)),
    avgDownloadMbps: avg(nums((p) => p.downloadMbps ?? 0)),
    maxDownloadMbps: max(nums((p) => p.downloadMbps ?? 0)),
    avgUploadMbps: avg(nums((p) => p.uploadMbps ?? 0)),
    maxUploadMbps: max(nums((p) => p.uploadMbps ?? 0)),
    avgMoboTemp: avg(nums((p) => p.moboTemperature ?? 0)),
    maxMoboTemp: max(nums((p) => p.moboTemperature ?? 0)),
  }
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
