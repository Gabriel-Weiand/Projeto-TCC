import Allocation from '#models/allocation'
import Telemetry from '#models/telemetry'
import { parseTimestampMs } from '#services/telemetry_downsample'

export type ProcessWireSnapshot = {
  pid: number
  name: string
  username: string
  cpuPercent: number
  ramMb: number
  vramMb?: number
  gpuUse?: number
  diskReadKbps?: number
  diskWriteKbps?: number
}

export type ProcessSessionSummaryWire = {
  pid: number
  name: string
  username: string
  sampleCount: number
  avgCpuPercent: number
  maxCpuPercent: number
  avgRamMb: number
  maxRamMb: number
  avgVramMb?: number
  maxVramMb?: number
  avgGpuUse?: number
  maxGpuUse?: number
  avgDiskReadKbps?: number
  maxDiskReadKbps?: number
  avgDiskWriteKbps?: number
  maxDiskWriteKbps?: number
}

type MetricAcc = {
  weightedSum: number
  totalWeight: number
  max: number
  hasData: boolean
}

type ProcessAcc = {
  pid: number
  name: string
  username: string
  sampleCount: number
  cpuPercent: MetricAcc
  ramMb: MetricAcc
  vramMb: MetricAcc
  gpuUse: MetricAcc
  diskReadKbps: MetricAcc
  diskWriteKbps: MetricAcc
}

function emptyMetricAcc(): MetricAcc {
  return { weightedSum: 0, totalWeight: 0, max: -Infinity, hasData: false }
}

function emptyProcessAcc(pid: number, name: string, username: string): ProcessAcc {
  return {
    pid,
    name,
    username,
    sampleCount: 0,
    cpuPercent: emptyMetricAcc(),
    ramMb: emptyMetricAcc(),
    vramMb: emptyMetricAcc(),
    gpuUse: emptyMetricAcc(),
    diskReadKbps: emptyMetricAcc(),
    diskWriteKbps: emptyMetricAcc(),
  }
}

function processKey(pid: number, name: string): string {
  return `${pid}\0${name}`
}

function addMetricSample(acc: MetricAcc, value: number | undefined, weightMs: number): void {
  if (weightMs <= 0 || typeof value !== 'number' || Number.isNaN(value)) return
  acc.hasData = true
  acc.weightedSum += value * weightMs
  acc.totalWeight += weightMs
  if (value > acc.max) acc.max = value
}

function finalizeMetricAvg(acc: MetricAcc): number | null {
  if (!acc.hasData || acc.totalWeight <= 0) return null
  return Math.round(acc.weightedSum / acc.totalWeight)
}

function finalizeMetricMax(acc: MetricAcc): number | null {
  if (!acc.hasData) return null
  return acc.max
}

function asProcessSnapshot(raw: unknown): ProcessWireSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const pid = typeof p.pid === 'number' ? p.pid : null
  const name = typeof p.name === 'string' ? p.name : null
  const username = typeof p.username === 'string' ? p.username : null
  const cpuPercent = typeof p.cpuPercent === 'number' ? p.cpuPercent : null
  const ramMb = typeof p.ramMb === 'number' ? p.ramMb : null
  if (pid == null || !name || !username || cpuPercent == null || ramMb == null) return null

  const out: ProcessWireSnapshot = { pid, name, username, cpuPercent, ramMb }
  if (typeof p.vramMb === 'number') out.vramMb = p.vramMb
  if (typeof p.gpuUse === 'number') out.gpuUse = p.gpuUse
  if (typeof p.diskReadKbps === 'number') out.diskReadKbps = p.diskReadKbps
  if (typeof p.diskWriteKbps === 'number') out.diskWriteKbps = p.diskWriteKbps
  return out
}

/** Mescla entradas duplicadas (mesmo pid+nome) dentro de uma amostra, somando métricas. */
export function mergeProcessSnapshotsInSample(processes: unknown[] | null | undefined): ProcessWireSnapshot[] {
  if (!processes || !Array.isArray(processes)) return []

  const merged = new Map<string, ProcessWireSnapshot>()
  for (const raw of processes) {
    const snap = asProcessSnapshot(raw)
    if (!snap) continue
    const key = processKey(snap.pid, snap.name)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...snap })
      continue
    }
    existing.cpuPercent += snap.cpuPercent
    existing.ramMb += snap.ramMb
    existing.vramMb = (existing.vramMb ?? 0) + (snap.vramMb ?? 0)
    existing.gpuUse = (existing.gpuUse ?? 0) + (snap.gpuUse ?? 0)
    existing.diskReadKbps = (existing.diskReadKbps ?? 0) + (snap.diskReadKbps ?? 0)
    existing.diskWriteKbps = (existing.diskWriteKbps ?? 0) + (snap.diskWriteKbps ?? 0)
    existing.username = snap.username
  }
  return [...merged.values()]
}

/**
 * Agrega processos da sessão por (pid, name) com TWA para médias e máximo para picos.
 */
export function buildProcessSummary(
  telemetries: Telemetry[],
  allocation: Allocation
): ProcessSessionSummaryWire[] {
  if (telemetries.length === 0) return []

  const sorted = [...telemetries].sort(
    (a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp)
  )
  const allocEndMs = allocation.endTime.toMillis()
  const accs = new Map<string, ProcessAcc>()

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]
    const merged = mergeProcessSnapshotsInSample(row.processes)
    if (merged.length === 0) continue

    const currentT = parseTimestampMs(row.timestamp)
    const nextT =
      i < sorted.length - 1 ? parseTimestampMs(sorted[i + 1].timestamp) : allocEndMs
    const weight = Math.max(0, nextT - currentT)

    for (const proc of merged) {
      const key = processKey(proc.pid, proc.name)
      let acc = accs.get(key)
      if (!acc) {
        acc = emptyProcessAcc(proc.pid, proc.name, proc.username)
        accs.set(key, acc)
      }
      acc.sampleCount += 1
      acc.username = proc.username
      addMetricSample(acc.cpuPercent, proc.cpuPercent, weight)
      addMetricSample(acc.ramMb, proc.ramMb, weight)
      addMetricSample(acc.vramMb, proc.vramMb, weight)
      addMetricSample(acc.gpuUse, proc.gpuUse, weight)
      addMetricSample(acc.diskReadKbps, proc.diskReadKbps, weight)
      addMetricSample(acc.diskWriteKbps, proc.diskWriteKbps, weight)
    }
  }

  const summaries: ProcessSessionSummaryWire[] = []
  for (const acc of accs.values()) {
    const avgCpu = finalizeMetricAvg(acc.cpuPercent)
    const maxCpu = finalizeMetricMax(acc.cpuPercent)
    const avgRam = finalizeMetricAvg(acc.ramMb)
    const maxRam = finalizeMetricMax(acc.ramMb)
    if (avgCpu == null || maxCpu == null || avgRam == null || maxRam == null) continue

    const summary: ProcessSessionSummaryWire = {
      pid: acc.pid,
      name: acc.name,
      username: acc.username,
      sampleCount: acc.sampleCount,
      avgCpuPercent: avgCpu,
      maxCpuPercent: maxCpu,
      avgRamMb: avgRam,
      maxRamMb: maxRam,
    }

    const avgVram = finalizeMetricAvg(acc.vramMb)
    const maxVram = finalizeMetricMax(acc.vramMb)
    if (avgVram != null && maxVram != null) {
      summary.avgVramMb = avgVram
      summary.maxVramMb = maxVram
    }

    const avgGpu = finalizeMetricAvg(acc.gpuUse)
    const maxGpu = finalizeMetricMax(acc.gpuUse)
    if (avgGpu != null && maxGpu != null) {
      summary.avgGpuUse = avgGpu
      summary.maxGpuUse = maxGpu
    }

    const avgRead = finalizeMetricAvg(acc.diskReadKbps)
    const maxRead = finalizeMetricMax(acc.diskReadKbps)
    if (avgRead != null && maxRead != null) {
      summary.avgDiskReadKbps = avgRead
      summary.maxDiskReadKbps = maxRead
    }

    const avgWrite = finalizeMetricAvg(acc.diskWriteKbps)
    const maxWrite = finalizeMetricMax(acc.diskWriteKbps)
    if (avgWrite != null && maxWrite != null) {
      summary.avgDiskWriteKbps = avgWrite
      summary.maxDiskWriteKbps = maxWrite
    }

    summaries.push(summary)
  }

  summaries.sort((a, b) => b.maxCpuPercent - a.maxCpuPercent)
  return summaries
}
