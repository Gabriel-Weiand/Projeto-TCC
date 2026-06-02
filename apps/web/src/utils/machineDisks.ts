import type { DiskPartition } from "@/types";

export function diskPartitionKey(d: DiskPartition, index = 0): string {
  return `${d.device}|${d.mountpoint}|${index}`;
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

export function diskUsedPct(total: number | null, free: number | null): number {
  if (!total || total <= 0 || free == null) return 0;
  return Math.round(((total - free) / total) * 100);
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

export function sumDisksFreeGb(
  disks: DiskPartition[] | null | undefined,
): number | null {
  if (!disks?.length) return null;
  const sum = disks.reduce((acc, d) => acc + Number(d.freeGb ?? 0), 0);
  if (sum <= 0 && !disks.some((d) => d.freeGb != null)) return null;
  return Math.round(sum * 10) / 10;
}

/** Texto padronizado: livre primeiro, depois percentual de uso. */
export function formatDiskFreeThenUsage(
  totalGb: number | null | undefined,
  freeGb: number | null | undefined,
): string | null {
  if (totalGb == null && freeGb == null) return null;
  const freePart =
    freeGb != null ? `${freeGb.toFixed(1)} GB livre` : "— livre";
  const pct = diskUsedPct(totalGb ?? null, freeGb ?? null);
  return `${freePart} · ${pct}% uso`;
}

export function formatPartitionFreeUsage(d: DiskPartition): string | null {
  return formatDiskFreeThenUsage(d.totalGb, d.freeGb);
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

export function machineAggregateDiskFreeUsage(machine: {
  disks?: DiskPartition[] | null;
  totalDiskGb?: number | null;
}): string | null {
  const total = displayTotalDiskGb(machine);
  const free = sumDisksFreeGb(machine.disks);
  return formatDiskFreeThenUsage(total, free);
}
