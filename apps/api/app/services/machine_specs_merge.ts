import type Machine from '#models/machine'
import { mergeDiskPartitionsFromAgent } from '#services/disk_partitions'

export type SyncSpecsPayload = {
  cpuModel?: string | null
  gpuModel?: string | null
  totalRamGb?: number | null
  totalVramGb?: number | null
  totalDiskGb?: number | null
  ipAddress?: string | null
  hostFingerprint?: string | null
  disks?: unknown
}

function isEmptyString(value: unknown): boolean {
  if (value == null) return true
  if (typeof value !== 'string') return false
  return value.trim().length === 0
}

function isEmptyWireGb(value: unknown): boolean {
  if (value == null) return true
  if (typeof value !== 'number' || Number.isNaN(value)) return true
  return value <= 0
}

function applyStringIfEmpty(
  current: string | null | undefined,
  incoming: string | null | undefined
): string | null | undefined {
  if (!isEmptyString(incoming) && isEmptyString(current)) {
    return typeof incoming === 'string' ? incoming.trim() : incoming
  }
  return current
}

function applyWireGbIfEmpty(
  current: number | null | undefined,
  incoming: number | null | undefined
): number | null | undefined {
  if (!isEmptyWireGb(incoming) && isEmptyWireGb(current)) {
    return incoming!
  }
  return current
}

/**
 * Aplica specs do agente apenas em campos vazios.
 * Admin ou sync anterior preenchem o valor; limpar no painel reabilita o sync.
 */
export function applySyncSpecsIfEmpty(machine: Machine, incoming: SyncSpecsPayload): void {
  machine.cpuModel = applyStringIfEmpty(machine.cpuModel, incoming.cpuModel) ?? null
  machine.gpuModel = applyStringIfEmpty(machine.gpuModel, incoming.gpuModel) ?? null
  machine.ipAddress = applyStringIfEmpty(machine.ipAddress, incoming.ipAddress) ?? null
  machine.hostFingerprint =
    applyStringIfEmpty(machine.hostFingerprint, incoming.hostFingerprint) ?? null
  machine.totalRamGb = applyWireGbIfEmpty(machine.totalRamGb, incoming.totalRamGb) ?? null
  machine.totalVramGb = applyWireGbIfEmpty(machine.totalVramGb, incoming.totalVramGb) ?? null
  machine.totalDiskGb = applyWireGbIfEmpty(machine.totalDiskGb, incoming.totalDiskGb) ?? null

  if (incoming.disks !== undefined && Array.isArray(incoming.disks)) {
    machine.disks = mergeDiskPartitionsFromAgent(incoming.disks, machine.disks)
  }
}

/** Converte GB decimal (API/front) para wire GB×10 (agente/DB). */
export function apiGbToWire(apiGb: number): number {
  return Math.round(apiGb * 10)
}

/** Normaliza payload admin: GB decimal → wire para colunas do agente. */
export function normalizeAdminMachineWireFields(data: Record<string, unknown>): void {
  if (data.totalRamGb !== undefined && data.totalRamGb !== null) {
    data.totalRamGb = apiGbToWire(Number(data.totalRamGb))
  }
  if (data.totalVramGb !== undefined && data.totalVramGb !== null) {
    data.totalVramGb = apiGbToWire(Number(data.totalVramGb))
  }
  if (data.totalDiskGb !== undefined && data.totalDiskGb !== null) {
    data.totalDiskGb = apiGbToWire(Number(data.totalDiskGb))
  }
}
