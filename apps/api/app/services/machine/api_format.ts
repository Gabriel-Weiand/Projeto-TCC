import type Machine from '#models/machine'
import { enrichDiskPartitions } from '#services/machine/disk_partitions'
import {
  normalizeOperationalMode,
  resolveEffectiveMachineStatus,
} from '#services/machine/effective_status'
import { telemetryBuffer } from '#services/telemetry/buffer'
import { chartTelemetryBuffer } from '#services/telemetry/chart_buffer'
import { normalizeChartSeriesPoint } from '#services/telemetry/api_format'
import { normalizeRealtimeTelemetry } from '#services/telemetry/normalize'

/** Agente envia GB×10; respostas HTTP ao front em GB (1 decimal). */
export function agentGbToApi(wire: number | null | undefined): number | null {
  if (wire == null) return null
  return Number(wire) / 10
}

/** Partições vindas do agente (JSON) — id estável para keys no front. */
export function mapMachineDisks(disks: unknown) {
  return enrichDiskPartitions(disks).map((d, index) => ({
    id: index,
    device: d.device,
    mountpoint: d.mountpoint,
    fstype: d.fstype ?? null,
    totalGb: d.totalGb ?? null,
    freeGb: d.freeGb ?? null,
    usagePct: d.usagePct ?? null,
    role: d.role ?? 'user',
    mainDisk: Boolean(d.mainDisk),
    allocatable: d.role === 'user' ? d.allocatable !== false : false,
  }))
}

export function resolveParkTelemetry(machineId: number) {
  const live = telemetryBuffer.getLatest(machineId)
  if (live) return live
  return chartTelemetryBuffer.getLatestEntry(machineId)?.metrics ?? null
}

export function serializeMachineForApi(
  machine: Machine,
  rawTelemetry: unknown,
  occupiedMachineIds: Set<number>
) {
  const serialized = machine.serialize() as Record<string, unknown>
  const group = machine.group
  const operationalMode = normalizeOperationalMode(machine.status)
  const status = resolveEffectiveMachineStatus(machine, occupiedMachineIds)

  return {
    ...serialized,
    status,
    operationalMode,
    totalVramGb: agentGbToApi(machine.totalVramGb),
    totalRamGb: agentGbToApi(machine.totalRamGb),
    totalDiskGb: agentGbToApi(machine.totalDiskGb),
    machineGroupId: machine.machineGroupId,
    group: group
      ? {
          id: group.id,
          title: group.title,
          description: group.description,
        }
      : null,
    latestTelemetry: normalizeRealtimeTelemetry(rawTelemetry),
    disks: mapMachineDisks(machine.disks),
  }
}

export function buildChartHistory(machineId: number) {
  const chartRaw = chartTelemetryBuffer.getChartSeries(machineId)
  const chartMeta = chartTelemetryBuffer.getMeta(machineId)
  const normalizedChart = chartRaw.map((p) =>
    normalizeChartSeriesPoint(p as unknown as Record<string, unknown>)
  )

  return {
    points: normalizedChart,
    chartSeries: normalizedChart,
    meta: chartMeta,
  }
}

export function normalizeTelemetryStreamBatch(batch: unknown[]) {
  return batch
    .map((raw) => normalizeRealtimeTelemetry(raw))
    .filter((e): e is NonNullable<ReturnType<typeof normalizeRealtimeTelemetry>> => e != null)
}
