/**
 * Gera chart_series e telemetrias brutas para seed — perfis em degraus (sem senoides).
 */
import type { ProcessWireSnapshot } from '#services/telemetry/process_summary'
import type { TelemetrySetConfig } from '#services/telemetry/presets'

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

type SeedProcessTemplate = {
  pid: number
  name: string
  username: string
  cpuScale: number
  ramBaseMb: number
  ramScale: number
  vramScale?: number
  gpuScale?: number
  diskIoScale?: number
}

const LAB_USER = 'lab.gabriel_santos'

const SYNTH_PROCESS_NAMES = [
  'python3',
  'node',
  'ffmpeg',
  'bash',
  'make',
  'gcc',
  'java',
  'docker',
  'code',
  'chrome',
  'train.py',
  'rsync',
  'tar',
  'ssh',
  'systemd',
  'nginx',
  'postgres',
  'redis-server',
  'jupyter',
  'nvidia-smi',
] as const

const GPU_PROCESS_TEMPLATES: SeedProcessTemplate[] = [
  {
    pid: 12450,
    name: 'python3',
    username: LAB_USER,
    cpuScale: 0.52,
    ramBaseMb: 900,
    ramScale: 5200,
    vramScale: 0.58,
    gpuScale: 0.78,
    diskIoScale: 0.06,
  },
  {
    pid: 12478,
    name: 'python3',
    username: LAB_USER,
    cpuScale: 0.14,
    ramBaseMb: 240,
    ramScale: 1100,
    vramScale: 0.1,
    gpuScale: 0.08,
    diskIoScale: 0.02,
  },
  {
    pid: 8921,
    name: 'node',
    username: LAB_USER,
    cpuScale: 0.08,
    ramBaseMb: 180,
    ramScale: 640,
    vramScale: 0.04,
    gpuScale: 0.03,
  },
  {
    pid: 4102,
    name: 'systemd',
    username: 'root',
    cpuScale: 0.02,
    ramBaseMb: 12,
    ramScale: 48,
  },
  {
    pid: 3310,
    name: 'sshd',
    username: 'root',
    cpuScale: 0.01,
    ramBaseMb: 8,
    ramScale: 24,
  },
]

const CPU_PROCESS_TEMPLATES: SeedProcessTemplate[] = [
  {
    pid: 18220,
    name: 'ffmpeg',
    username: LAB_USER,
    cpuScale: 0.62,
    ramBaseMb: 420,
    ramScale: 2800,
    diskIoScale: 0.35,
  },
  {
    pid: 18221,
    name: 'python3',
    username: LAB_USER,
    cpuScale: 0.28,
    ramBaseMb: 320,
    ramScale: 1900,
    diskIoScale: 0.12,
  },
  {
    pid: 18222,
    name: 'make',
    username: LAB_USER,
    cpuScale: 0.45,
    ramBaseMb: 90,
    ramScale: 520,
    diskIoScale: 0.08,
  },
  {
    pid: 4102,
    name: 'systemd',
    username: 'root',
    cpuScale: 0.02,
    ramBaseMb: 12,
    ramScale: 48,
  },
]

const IO_PROCESS_TEMPLATES: SeedProcessTemplate[] = [
  {
    pid: 22001,
    name: 'rsync',
    username: LAB_USER,
    cpuScale: 0.22,
    ramBaseMb: 64,
    ramScale: 280,
    diskIoScale: 0.55,
  },
  {
    pid: 22002,
    name: 'python3',
    username: LAB_USER,
    cpuScale: 0.18,
    ramBaseMb: 210,
    ramScale: 980,
    diskIoScale: 0.28,
  },
  {
    pid: 22003,
    name: 'tar',
    username: LAB_USER,
    cpuScale: 0.12,
    ramBaseMb: 40,
    ramScale: 160,
    diskIoScale: 0.42,
  },
]

function processTemplatesForProfile(profile: UsageProfile, hasGpu: boolean): SeedProcessTemplate[] {
  if (profile === 'io_bursts') return IO_PROCESS_TEMPLATES
  if (!hasGpu || profile === 'cpu_batch' || profile === 'compile_spikes') {
    return CPU_PROCESS_TEMPLATES
  }
  return GPU_PROCESS_TEMPLATES
}

function synthesizeExtraProcessSnapshots(
  count: number,
  level: LevelSample,
  hw: SeedHardware,
  startRank: number
): ProcessWireSnapshot[] {
  const vramTotalMb =
    hw.hasGpu && hw.vramTotalGbWire ? Math.round((hw.vramTotalGbWire / 10) * 1024) : 0
  const out: ProcessWireSnapshot[] = []

  for (let i = 0; i < count; i++) {
    const rank = startRank + i
    const decay = 1 / (1 + rank * 0.07)
    const name = SYNTH_PROCESS_NAMES[rank % SYNTH_PROCESS_NAMES.length]
    const username = rank % 9 === 0 ? 'root' : LAB_USER
    const cpuPercent = Math.max(1, Math.round(level.cpu * 1000 * decay * 0.35))
    const ramMb = Math.max(8, Math.round((40 + level.ram * 900) * decay))
    const proc: ProcessWireSnapshot = {
      pid: 50_000 + rank,
      name,
      username,
      cpuPercent,
      ramMb,
    }
    if (hw.hasGpu && vramTotalMb > 0 && rank % 3 !== 0) {
      proc.vramMb = Math.max(0, Math.round(level.gpu * vramTotalMb * decay * 0.04))
      proc.gpuUse = Math.max(0, Math.round(level.gpu * 1000 * decay * 0.05))
    }
    if (level.diskIo && rank % 4 === 0) {
      const ioBase = 600 + level.cpu * 3200 * decay
      proc.diskReadKbps = Math.round(ioBase)
      proc.diskWriteKbps = Math.round(ioBase * 0.4)
    }
    out.push(proc)
  }

  return out
}

/** Top processos wire (×10 em cpu/gpu) coerentes com o nível de carga da amostra. */
export function generateProcessSnapshotsWire(
  level: LevelSample,
  hw: SeedHardware,
  profile: UsageProfile,
  topX: number = 8
): ProcessWireSnapshot[] {
  const limit = Math.max(1, Math.min(topX, 100))

  if (level.cpu < 0.08 && level.gpu < 0.05) {
    const idleCount = Math.min(limit, 2)
    const idle = processTemplatesForProfile(profile, hw.hasGpu)
      .filter((t) => t.username === 'root')
      .slice(0, idleCount)
      .map((t) => ({
        pid: t.pid,
        name: t.name,
        username: t.username,
        cpuPercent: Math.round(level.cpu * 1000 * t.cpuScale * 4),
        ramMb: Math.round(t.ramBaseMb + level.ram * t.ramScale * 0.15),
      }))
    if (idle.length >= limit) return idle
    return [
      ...idle,
      ...synthesizeExtraProcessSnapshots(limit - idle.length, level, hw, idle.length),
    ].slice(0, limit)
  }

  const load = Math.max(level.cpu, level.gpu * 0.85)
  const vramTotalMb =
    hw.hasGpu && hw.vramTotalGbWire ? Math.round((hw.vramTotalGbWire / 10) * 1024) : 0

  const procs = processTemplatesForProfile(profile, hw.hasGpu).map((t) => {
    const cpuPercent = Math.round(level.cpu * 1000 * t.cpuScale * (1 + load * 0.35))
    const ramMb = Math.round(t.ramBaseMb + level.ram * t.ramScale * (0.4 + load * 0.6))
    const proc: ProcessWireSnapshot = {
      pid: t.pid,
      name: t.name,
      username: t.username,
      cpuPercent,
      ramMb,
    }
    if (hw.hasGpu && t.vramScale != null && vramTotalMb > 0) {
      proc.vramMb = Math.round(level.gpu * vramTotalMb * t.vramScale)
      proc.gpuUse = Math.round(level.gpu * 1000 * (t.gpuScale ?? 0))
    }
    if (level.diskIo && t.diskIoScale != null) {
      const ioBase = 800 + level.cpu * 4200
      proc.diskReadKbps = Math.round(ioBase * t.diskIoScale)
      proc.diskWriteKbps = Math.round(ioBase * t.diskIoScale * 0.42)
    }
    return proc
  })

  if (procs.length < limit) {
    procs.push(...synthesizeExtraProcessSnapshots(limit - procs.length, level, hw, procs.length))
  }

  procs.sort((a, b) => b.cpuPercent - a.cpuPercent)
  return procs.slice(0, limit)
}

export function seedDisksInfoWire(level: LevelSample): Record<string, unknown>[] {
  return [
    {
      mountpoint: '/',
      totalGb: 480,
      freeGb: Math.round(120 + (1 - level.ram) * 80),
      usagePct: Math.round(650 + level.ram * 250),
      diskReadMbps: level.diskIo ? Math.round(80 + level.cpu * 400) : 0,
      diskWriteMbps: level.diskIo ? Math.round(40 + level.cpu * 180) : 0,
    },
    {
      mountpoint: '/data',
      totalGb: 1920,
      freeGb: Math.round(900 + (1 - level.ram) * 200),
      usagePct: Math.round(450 + level.ram * 180),
      diskReadMbps: level.diskIo ? Math.round(120 + level.cpu * 900) : 0,
      diskWriteMbps: level.diskIo ? Math.round(60 + level.cpu * 420) : 0,
    },
  ]
}

export function seedActiveUsersWire(): Record<string, unknown>[] {
  return [
    {
      username: LAB_USER,
      terminal: 'pts/0',
      host: '192.168.8.55',
      startedAt: new Date().toISOString(),
    },
    {
      username: 'lab.maria_oliveira',
      terminal: 'pts/1',
      host: '192.168.8.60',
      startedAt: new Date().toISOString(),
    },
  ]
}

/** Aplica telemetrySet ao row de seed (campos omitidos quando a métrica está desligada). */
export function applyTelemetrySetToSeedRow(
  row: RawTelemetrySeed & {
    disksInfo?: Record<string, unknown>[] | null
    activeUsers?: Record<string, unknown>[] | null
  },
  set: TelemetrySetConfig,
  level: LevelSample
): typeof row {
  const out: typeof row = {
    allocationId: row.allocationId,
    timestamp: row.timestamp,
    cpuUsage: row.cpuUsage,
    cpuTemp: row.cpuTemp,
    gpuUsage: set.gpu ? row.gpuUsage : 0,
    gpuTemp: set.gpu ? row.gpuTemp : 0,
  }

  if (set.ramAndSwap) {
    out.ramTotalGb = row.ramTotalGb
    out.ramUsedGb = row.ramUsedGb
    out.swapTotalGb = row.swapTotalGb
    out.swapUsedGb = row.swapUsedGb
  }

  if (set.gpu) {
    out.gpuPowerWatts = row.gpuPowerWatts
    out.vramTotalGb = row.vramTotalGb
    out.vramUsedGb = row.vramUsedGb
  }

  if (set.temperatures) {
    out.moboTemperature = row.moboTemperature
  }

  if (set.disk) {
    out.diskReadMbps = row.diskReadMbps
    out.diskWriteMbps = row.diskWriteMbps
    out.disksInfo = row.disksInfo ?? seedDisksInfoWire(level)
  }

  if (set.networkIO) {
    out.downloadMbps = row.downloadMbps ?? Math.round(20 + level.cpu * 140)
    out.uploadMbps = row.uploadMbps ?? Math.round(6 + level.cpu * 40)
  }

  if (set.activeUsers) {
    out.activeUsers = row.activeUsers ?? seedActiveUsersWire()
  }

  if (set.processCapture && row.processes) {
    out.processes = row.processes
  }

  return out
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
    point.vramUsedGb = Math.round(level.gpu * vramTotal)
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
  disksInfo?: Record<string, unknown>[] | null
  activeUsers?: Record<string, unknown>[] | null
  processes?: ProcessWireSnapshot[]
}

export type { RawTelemetrySeed }

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
    includeProcessCapture?: boolean
    processTopX?: number
    telemetrySet?: TelemetrySetConfig
  } = {}
): RawTelemetrySeed[] {
  const {
    profile = 'training_burst',
    hasGpu = true,
    ramTotalGbWire = 960,
    vramTotalGbWire = 480,
    includeDiskIo = true,
    includeProcessCapture = false,
    processTopX = 10,
    telemetrySet,
  } = options

  const captureEnabled = telemetrySet?.processCapture ?? includeProcessCapture
  const processLimit = telemetrySet?.processCapture
    ? (processTopX ?? 10)
    : includeProcessCapture
      ? processTopX
      : 0

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
    let row: RawTelemetrySeed = {
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
      downloadMbps: Math.round(20 + level.cpu * 140),
      uploadMbps: Math.round(6 + level.cpu * 40),
      disksInfo: seedDisksInfoWire(level),
      activeUsers: seedActiveUsersWire(),
    }
    if (captureEnabled && processLimit > 0) {
      row.processes = generateProcessSnapshotsWire(level, hw, profile, processLimit)
    }
    if (telemetrySet) {
      row = applyTelemetrySetToSeedRow(row, telemetrySet, level)
    } else if (!includeProcessCapture) {
      delete row.processes
    }
    records.push(row)
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
