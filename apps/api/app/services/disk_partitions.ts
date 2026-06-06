export type DiskPartitionRole = 'system' | 'user'

export type DiskPartitionRecord = {
  device: string
  mountpoint: string
  fstype?: string | null
  totalGb?: number | null
  freeGb?: number | null
  role?: DiskPartitionRole
  mainDisk?: boolean
}

const SYSTEM_EXACT = new Set(['/', '/boot', '/boot/efi', '/efi', '/recovery'])
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

  let mainMount = userDisks.find((d) => d.mainDisk)?.mountpoint
  if (!mainMount) {
    mainMount = pickDefaultMainUserDisk(withRoles)?.mountpoint ?? null
  }

  return withRoles.map((d) => ({
    ...d,
    mainDisk: d.role === 'user' && d.mountpoint === mainMount,
  }))
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
    }
  })
  return applyMainDiskDefaults(mapped)
}

/** Mescla flags admin (`mainDisk`) ao atualizar specs do agente. */
export function mergeDiskPartitionsFromAgent(
  incoming: unknown,
  existing: unknown
): DiskPartitionRecord[] {
  const prevByMount = new Map<string, DiskPartitionRecord>()
  for (const d of enrichDiskPartitions(existing)) {
    prevByMount.set(d.mountpoint, d)
  }

  if (!Array.isArray(incoming)) {
    return applyMainDiskDefaults(Array.from(prevByMount.values()))
  }

  const merged = incoming.map((raw, index) => {
    const d = raw as Record<string, unknown>
    const mountpoint = String(d.mountpoint ?? '')
    const role = classifyDiskPartitionRole(mountpoint)
    const prev = prevByMount.get(mountpoint)
    return {
      device: String(d.device ?? prev?.device ?? `disk-${index}`),
      mountpoint,
      fstype: (d.fstype as string | null | undefined) ?? prev?.fstype ?? null,
      totalGb: d.totalGb != null ? Number(d.totalGb) : (prev?.totalGb ?? null),
      freeGb: d.freeGb != null ? Number(d.freeGb) : (prev?.freeGb ?? null),
      role,
      mainDisk: prev?.mainDisk ?? false,
    }
  })

  return applyMainDiskDefaults(merged)
}

/** Partições de user-space elegíveis para alocação. */
export function listUserDiskPartitions(disks: unknown): DiskPartitionRecord[] {
  return enrichDiskPartitions(disks).filter((d) => d.role === 'user' && d.mountpoint)
}

export function listUserDiskMountpoints(disks: unknown): string[] {
  return listUserDiskPartitions(disks).map((d) => d.mountpoint)
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
  return listUserDiskMountpoints(disks)
}

export function resolveHomeDirectory(
  systemUsername: string,
  homeMountpoint: string | null | undefined
): string | null {
  if (!homeMountpoint?.trim()) return null
  const base = homeMountpoint.replace(/\/+$/, '')
  return `${base}/${systemUsername}`
}

/** Normaliza mount solicitado: vazio → main disk; valida user-space e política onlyMainDisk. */
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
    return { mountpoint: resolveMainDiskMountpoint(disks), error: null }
  }

  if (!allowed.includes(trimmed)) {
    return { mountpoint: null, error: 'Montagem de disco inválida para esta máquina.' }
  }

  return { mountpoint: trimmed, error: null }
}

export function isHomeMountpointAllowed(
  disks: unknown,
  onlyMainDisk: boolean,
  homeMountpoint: string | null | undefined
): boolean {
  return normalizeAllocationHomeMount(disks, onlyMainDisk, homeMountpoint).error === null
}
