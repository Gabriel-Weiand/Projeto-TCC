import type { DiskPartition } from "@/types";

export function diskPartitionKey(d: DiskPartition, index = 0): string {
  return `${d.device}|${d.mountpoint}|${index}`;
}

export function listUserDiskPartitions(
  disks: DiskPartition[] | null | undefined,
): DiskPartition[] {
  if (!disks?.length) return [];
  return disks.filter((d) => (d.role ?? "user") === "user" && d.mountpoint);
}

export function listUserDiskMountpoints(
  disks: DiskPartition[] | null | undefined,
): string[] {
  return listUserDiskPartitions(disks).map((d) => d.mountpoint);
}

export function resolveMainDiskMountpoint(
  disks: DiskPartition[] | null | undefined,
): string | null {
  const userDisks = listUserDiskPartitions(disks);
  const main = userDisks.find((d) => d.mainDisk);
  if (main) return main.mountpoint;
  return userDisks[0]?.mountpoint ?? null;
}

export function listAllocatableDiskMountpoints(
  disks: DiskPartition[] | null | undefined,
  onlyMainDisk: boolean,
): string[] {
  if (onlyMainDisk) {
    const main = resolveMainDiskMountpoint(disks);
    return main ? [main] : [];
  }
  return listUserDiskPartitions(disks)
    .filter((d) => d.allocatable !== false)
    .map((d) => d.mountpoint);
}

export function resolveDefaultAllocationHomeMount(
  disks: DiskPartition[] | null | undefined,
  onlyMainDisk: boolean,
): string {
  const allowed = listAllocatableDiskMountpoints(disks, onlyMainDisk);
  if (allowed.length === 0) return "";
  const main = resolveMainDiskMountpoint(disks);
  if (main && allowed.includes(main)) return main;
  return allowed[0] ?? "";
}

export function applyMainDiskSelection(
  disks: DiskPartition[],
  mountpoint: string,
): DiskPartition[] {
  return disks.map((d) => ({
    ...d,
    mainDisk: (d.role ?? "user") === "user" && d.mountpoint === mountpoint,
    allocatable:
      (d.role ?? "user") === "user" && d.mountpoint === mountpoint
        ? true
        : d.allocatable,
  }));
}

export function defaultHomeMountForMachine(machine: {
  disks?: DiskPartition[] | null;
  onlyMainDisk?: boolean;
}): string {
  return resolveDefaultAllocationHomeMount(
    machine.disks,
    Boolean(machine.onlyMainDisk),
  );
}

export function formatDiskOptionLabel(
  mountpoint: string,
  disks: DiskPartition[] | null | undefined,
): string {
  const part = listUserDiskPartitions(disks).find((d) => d.mountpoint === mountpoint);
  if (!part) return mountpoint;
  const size =
    part.totalGb != null ? `${part.totalGb} GB` : "";
  const main = part.mainDisk ? " · principal" : "";
  return size ? `${mountpoint} (${size})${main}` : `${mountpoint}${main}`;
}

export function mergeDiskPartitionsWithTelemetry(
  base: DiskPartition[] | null | undefined,
  telemetry:
    | Array<{
        mountpoint?: string
        freeGb?: number | null
        totalGb?: number | null
        usagePct?: number | null
      }>
    | null
    | undefined,
): DiskPartition[] {
  if (!base?.length) return []
  if (!telemetry?.length) return base

  const byMount = new Map(
    telemetry.filter((t) => t.mountpoint).map((t) => [String(t.mountpoint), t]),
  )

  return base.map((d) => {
    const t = byMount.get(d.mountpoint)
    if (!t) return d

    let totalGb = t.totalGb ?? d.totalGb ?? null
    let freeGb = t.freeGb ?? d.freeGb ?? null

    if ((totalGb == null || totalGb <= 0) && freeGb != null && t.usagePct != null) {
      const pct = Number(t.usagePct) / 10
      if (Number.isFinite(pct) && pct >= 0 && pct < 100) {
        totalGb = Math.round((freeGb / (1 - pct / 100)) * 10) / 10
      }
    }

    const sanitized = sanitizeDiskCapacities(totalGb, freeGb)
    return {
      ...d,
      totalGb: sanitized.totalGb,
      freeGb: sanitized.freeGb,
      usagePct: t.usagePct ?? d.usagePct ?? null,
    }
  })
}

export function partitionRoleLabel(role: DiskPartition["role"]): string {
  return role === "system" ? "Sistema" : "Usuário";
}

/** Partição com maior capacidade total (para cards resumidos do parque). */
export function getLargestDisk(
  disks: DiskPartition[] | null | undefined,
): DiskPartition | null {
  if (!disks?.length) return null;
  return disks.reduce((best, d) =>
    (d.totalGb ?? 0) > (best.totalGb ?? 0) ? d : best,
  );
}

export function diskUsedPct(
  total: number | null,
  free: number | null,
  usagePctWire?: number | null,
): number {
  if (usagePctWire != null && Number.isFinite(Number(usagePctWire))) {
    const pct = Number(usagePctWire) / 10
    return Math.min(100, Math.max(0, Math.round(pct)))
  }
  if (total == null || total <= 0 || free == null) return 0
  const freeClamped = Math.min(Math.max(0, free), total)
  const raw = ((total - freeClamped) / total) * 100
  return Math.min(100, Math.max(0, Math.round(raw)))
}

function sanitizeDiskCapacities(
  totalGb: number | null | undefined,
  freeGb: number | null | undefined,
): { totalGb: number | null; freeGb: number | null } {
  let total = totalGb ?? null
  let free = freeGb ?? null
  if (total != null && total < 0) total = null
  if (free != null && free < 0) free = null
  if (total != null && free != null && free > total) free = total
  return { totalGb: total, freeGb: free }
}

export function sortDisksBySize(disks: DiskPartition[]): DiskPartition[] {
  return [...disks].sort((a, b) => (b.totalGb ?? 0) - (a.totalGb ?? 0));
}

/** Soma de `totalGb` de todas as partições acessíveis (igual ao computed da API). */
export function sumDisksTotalGb(
  disks: DiskPartition[] | null | undefined,
): number | null {
  if (!disks?.length) return null;
  const sum = disks.reduce((acc, d) => acc + Number(d.totalGb ?? 0), 0);
  if (sum <= 0) return null;
  return Math.round(sum * 10) / 10;
}

export function displayTotalDiskGb(machine: {
  totalDiskGb?: number | null;
  disks?: DiskPartition[] | null;
}): number | null {
  if (machine.totalDiskGb != null && machine.totalDiskGb > 0) {
    return machine.totalDiskGb;
  }
  return sumDisksTotalGb(machine.disks);
}

/** Nome do dispositivo da maior partição (card resumido do parque). */
export function primaryDiskDeviceName(
  disks: DiskPartition[] | null | undefined,
): string | null {
  const d = getLargestDisk(disks);
  return d?.device?.trim() || null;
}

/** Partição: `livre GB / total GB` (card do parque, linha inferior). */
export function formatPartitionFreeTotal(
  freeGb: number | null | undefined,
  totalGb: number | null | undefined,
): string | null {
  if (freeGb == null && totalGb == null) return null;
  const free = freeGb != null ? `${freeGb} GB` : "—";
  const total = totalGb != null ? `${totalGb} GB` : "—";
  return `${free} / ${total}`;
}
