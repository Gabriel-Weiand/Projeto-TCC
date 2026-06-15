export type DiskPartitionRole = 'system' | 'user'

export type DiskPartitionRecord = {
  device: string
  mountpoint: string
  fstype?: string | null
  totalGb?: number | null
  freeGb?: number | null
  /** Uso wire ×10 (telemetria); opcional. */
  usagePct?: number | null
  role?: DiskPartitionRole
  mainDisk?: boolean
  allocatable?: boolean
}

const SYSTEM_EXACT = new Set(['/boot', '/boot/efi', '/efi', '/recovery'])
const SYSTEM_PREFIXES = ['/boot/', '/efi/', '/var/', '/usr/', '/snap/', '/run/', '/dev/', '/proc/', '/sys/']

/** Classifica partição como sistema ou espaço destinado a dados de usuário. */
export function classifyDiskPartitionRole(mountpoint: string): DiskPartitionRole {
  const mp = mountpoint.trim()
  if (!mp) return 'system'
  if (SYSTEM_EXACT.has(mp)) return 'system'
  if (SYSTEM_PREFIXES.some((p) => mp.startsWith(p))) return 'system'
  return 'user'
}

function pickDefaultMainUserDisk(disks: DiskPartitionRecord[]): DiskPartitionRecord | null {
  const userDisks = disks.filter((d) => d.role === 'user' && d.mountpoint)
  if (userDisks.length === 0) return null
  const root = userDisks.find((d) => d.mountpoint === '/')
  if (root) return root
  return userDisks.reduce((best, d) =>
    (d.totalGb ?? 0) > (best.totalGb ?? 0) ? d : best
  )
}

/** Garante exatamente um `mainDisk` entre partições de usuário (maior disco se nenhum marcado). */
export function applyMainDiskDefaults(disks: DiskPartitionRecord[]): DiskPartitionRecord[] {
  const withRoles = disks.map((d) => ({
    ...d,
    role: d.role ?? classifyDiskPartitionRole(d.mountpoint),
    mainDisk: d.role === 'system' ? false : Boolean(d.mainDisk),
  }))

  const userDisks = withRoles.filter((d) => d.role === 'user')
  if (userDisks.length === 0) {
    return withRoles.map((d) => ({ ...d, mainDisk: false }))
  }

  let mainMount: string | undefined = userDisks.find((d) => d.mainDisk)?.mountpoint
  if (!mainMount) {
    mainMount = pickDefaultMainUserDisk(withRoles)?.mountpoint
  }

  return withRoles.map((d) => ({
    ...d,
    mainDisk: d.role === 'user' && d.mountpoint === mainMount,
  }))
}

/** Normaliza `allocatable`: sistema=false; user default true; principal sempre true. */
export function applyAllocatableDefaults(disks: DiskPartitionRecord[]): DiskPartitionRecord[] {
  return disks.map((d) => {
    if (d.role === 'system') {
      return { ...d, allocatable: false }
    }
    const allocatable = d.mainDisk ? true : d.allocatable !== false
    return { ...d, allocatable }
  })
}

function finalizeDiskPartitions(disks: DiskPartitionRecord[]): DiskPartitionRecord[] {
  return applyAllocatableDefaults(applyMainDiskDefaults(disks))
}

export function enrichDiskPartitions(disks: unknown): DiskPartitionRecord[] {
  if (!Array.isArray(disks)) return []
  const mapped = disks.map((raw, index) => {
    const d = raw as Record<string, unknown>
    const mountpoint = String(d.mountpoint ?? '')
    const role = (d.role as DiskPartitionRole | undefined) ?? classifyDiskPartitionRole(mountpoint)
    return {
      device: String(d.device ?? `disk-${index}`),
      mountpoint,
      fstype: (d.fstype as string | null | undefined) ?? null,
      totalGb: d.totalGb != null ? Number(d.totalGb) : null,
      freeGb: d.freeGb != null ? Number(d.freeGb) : null,
      role,
      mainDisk: role === 'user' ? Boolean(d.mainDisk) : false,
      allocatable:
        role === 'user'
          ? d.allocatable === undefined
            ? true
            : Boolean(d.allocatable)
          : false,
    }
  })
  return finalizeDiskPartitions(mapped)
}

function parseIncomingGb(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return !Number.isNaN(n) ? n : null
}

/** Garante free ≤ total e valores não negativos (evita % negativo por arredondamento). */
export function sanitizeDiskCapacities(
  totalGb: number | null | undefined,
  freeGb: number | null | undefined
): { totalGb: number | null; freeGb: number | null } {
  let total = totalGb ?? null
  let free = freeGb ?? null
  if (total != null && total < 0) total = null
  if (free != null && free < 0) free = null
  if (total != null && free != null && free > total) free = total
  return { totalGb: total, freeGb: free }
}

/** Percentual de uso 0–100 a partir de capacidades ou usagePct wire (×10) do agente. */
export function diskUsagePercent(
  totalGb: number | null | undefined,
  freeGb: number | null | undefined,
  usagePctWire?: number | null
): number {
  if (usagePctWire != null && Number.isFinite(Number(usagePctWire))) {
    const pct = Number(usagePctWire) / 10
    return Math.min(100, Math.max(0, Math.round(pct)))
  }
  const { totalGb: total, freeGb: free } = sanitizeDiskCapacities(totalGb, freeGb)
  if (total == null || total <= 0 || free == null) return 0
  const raw = ((total - free) / total) * 100
  return Math.min(100, Math.max(0, Math.round(raw)))
}

/** Deriva total a partir de livre + usagePct (wire ×10) quando total não veio no payload. */
function deriveTotalGbFromUsage(
  freeGb: number | null,
  usagePctWire: unknown
): number | null {
  if (freeGb == null || usagePctWire == null) return null
  const pct = Number(usagePctWire) / 10
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return null
  return Math.round((freeGb / (1 - pct / 100)) * 10) / 10
}

/** Mescla flags admin (`mainDisk`, `allocatable`) ao atualizar specs/telemetria do agente. */
export function mergeDiskPartitionsFromAgent(
  incoming: unknown,
  existing: unknown
): DiskPartitionRecord[] {
  const prevByMount = new Map<string, DiskPartitionRecord>()
  for (const d of enrichDiskPartitions(existing)) {
    prevByMount.set(d.mountpoint, d)
  }

  if (!Array.isArray(incoming)) {
    return finalizeDiskPartitions(Array.from(prevByMount.values()))
  }

  const merged = incoming.map((raw, index) => {
    const d = raw as Record<string, unknown>
    const mountpoint = String(d.mountpoint ?? '')
    const role =
      (d.role as DiskPartitionRole | undefined) ??
      classifyDiskPartitionRole(mountpoint)
    const prev = prevByMount.get(mountpoint)
    prevByMount.delete(mountpoint)

    const incomingFree = parseIncomingGb(d.freeGb)
    const incomingTotal = parseIncomingGb(d.totalGb)
    const derivedTotal = deriveTotalGbFromUsage(incomingFree, d.usagePct)
    const { totalGb, freeGb } = sanitizeDiskCapacities(
      incomingTotal ?? derivedTotal ?? prev?.totalGb ?? null,
      incomingFree ?? prev?.freeGb ?? null
    )
    const usagePctWire = d.usagePct != null ? Number(d.usagePct) : null
    const usagePct =
      usagePctWire != null && !Number.isNaN(usagePctWire) ? usagePctWire : (prev?.usagePct ?? null)

    return {
      device: String(d.device ?? prev?.device ?? `disk-${index}`),
      mountpoint,
      fstype: (d.fstype as string | null | undefined) ?? prev?.fstype ?? null,
      totalGb,
      freeGb,
      usagePct,
      role,
      mainDisk: prev?.mainDisk ?? false,
      allocatable:
        role === 'user' ? (prev?.allocatable !== undefined ? prev.allocatable : true) : false,
    }
  })

  const leftovers = Array.from(prevByMount.values())
  return finalizeDiskPartitions([...merged, ...leftovers])
}

/**
 * Atualiza livre/total a partir de disksInfo da telemetria.
 * Preserva device/fstype/role e flags admin (mainDisk, allocatable).
 */
export function mergeDiskPartitionsFromTelemetry(
  disksInfo: unknown,
  existing: unknown
): DiskPartitionRecord[] {
  if (!Array.isArray(disksInfo) || disksInfo.length === 0) {
    return enrichDiskPartitions(existing)
  }
  return mergeDiskPartitionsFromAgent(disksInfo, existing)
}

/**
 * Admin só altera política (mainDisk, allocatable). Capacidade vem do agente.
 */
export function mergeAdminDiskPolicyUpdate(
  incoming: unknown,
  existing: unknown
): DiskPartitionRecord[] {
  const prevByMount = new Map(enrichDiskPartitions(existing).map((d) => [d.mountpoint, d]))
  if (!Array.isArray(incoming)) {
    return finalizeDiskPartitions(Array.from(prevByMount.values()))
  }

  const merged: DiskPartitionRecord[] = []
  for (const raw of incoming) {
    const d = raw as Record<string, unknown>
    const mountpoint = String(d.mountpoint ?? '')
    const prev = prevByMount.get(mountpoint)
    if (!prev) continue
    prevByMount.delete(mountpoint)

    const mainDisk = prev.role === 'user' ? Boolean(d.mainDisk) : false
    merged.push({
      ...prev,
      mainDisk,
      allocatable:
        prev.role === 'user'
          ? mainDisk
            ? true
            : d.allocatable !== false
          : false,
    })
  }

  return finalizeDiskPartitions([...merged, ...prevByMount.values()])
}

/** Partições de user-space elegíveis para alocação. */
export function listUserDiskPartitions(disks: unknown): DiskPartitionRecord[] {
  return enrichDiskPartitions(disks).filter((d) => d.role === 'user' && d.mountpoint)
}

export function resolveMainDiskMountpoint(disks: unknown): string | null {
  const main = listUserDiskPartitions(disks).find((d) => d.mainDisk)
  if (main) return main.mountpoint
  const userDisks = listUserDiskPartitions(disks)
  return userDisks[0]?.mountpoint ?? null
}

/** Discos que o usuário pode escolher na reserva. */
export function listAllocatableDiskMountpoints(
  disks: unknown,
  onlyMainDisk: boolean
): string[] {
  if (onlyMainDisk) {
    const main = resolveMainDiskMountpoint(disks)
    return main ? [main] : []
  }
  return listUserDiskPartitions(disks)
    .filter((d) => d.allocatable !== false)
    .map((d) => d.mountpoint)
}

export function resolveDefaultAllocationHomeMount(
  disks: unknown,
  onlyMainDisk: boolean
): string | null {
  const allowed = listAllocatableDiskMountpoints(disks, onlyMainDisk)
  if (allowed.length === 0) return null
  const main = resolveMainDiskMountpoint(disks)
  if (main && allowed.includes(main)) return main
  return allowed[0] ?? null
}

export function resolveHomeDirectory(
  systemUsername: string,
  homeMountpoint: string | null | undefined
): string | null {
  if (!homeMountpoint?.trim()) return null
  const base = homeMountpoint.replace(/\/+$/, '')
  return `${base}/${systemUsername}`
}

/** Valida política de discos antes de persistir config admin. */
export function validateMachineDiskPolicy(
  disks: unknown,
  onlyMainDisk: boolean
): string | null {
  const enriched = enrichDiskPartitions(disks)
  const userDisks = enriched.filter((d) => d.role === 'user')

  if (userDisks.length === 0) {
    return null
  }

  if (onlyMainDisk) {
    if (!resolveMainDiskMountpoint(enriched)) {
      return 'Defina um disco principal entre as partições de usuário.'
    }
    return null
  }

  return null
}

/** Normaliza mount solicitado: vazio → default allocatable; valida política onlyMainDisk. */
export function normalizeAllocationHomeMount(
  disks: unknown,
  onlyMainDisk: boolean,
  homeMountpoint: string | null | undefined
): { mountpoint: string | null; error: string | null } {
  const allowed = listAllocatableDiskMountpoints(disks, onlyMainDisk)
  const trimmed = homeMountpoint?.trim() || null

  if (allowed.length === 0) {
    return { mountpoint: null, error: null }
  }

  if (onlyMainDisk) {
    const main = resolveMainDiskMountpoint(disks)
    if (!main) return { mountpoint: null, error: null }
    if (trimmed && trimmed !== main) {
      return {
        mountpoint: null,
        error: 'Esta máquina aceita apenas o disco principal configurado pelo admin.',
      }
    }
    return { mountpoint: main, error: null }
  }

  if (!trimmed) {
    return { mountpoint: resolveDefaultAllocationHomeMount(disks, onlyMainDisk), error: null }
  }

  if (!allowed.includes(trimmed)) {
    return { mountpoint: null, error: 'Montagem de disco inválida para esta máquina.' }
  }

  return { mountpoint: trimmed, error: null }
}
