import type { ProcessSessionSummary, TelemetryProcessSnapshot } from "@/types";

export type ProcessSortKey =
  | "pid"
  | "name"
  | "username"
  | "cpuPercent"
  | "ramMb"
  | "vramMb"
  | "gpuUse"
  | "diskReadKbps"
  | "diskWriteKbps"
  | "avgCpuPercent"
  | "maxCpuPercent"
  | "avgRamMb"
  | "maxRamMb"
  | "avgVramMb"
  | "maxVramMb"
  | "avgGpuUse"
  | "maxGpuUse"
  | "avgDiskReadKbps"
  | "maxDiskReadKbps"
  | "avgDiskWriteKbps"
  | "maxDiskWriteKbps";

export type ProcessSortDir = "asc" | "desc";

export const PROCESS_SNAPSHOT_SORT_OPTIONS: { value: ProcessSortKey; label: string }[] = [
  { value: "pid", label: "PID" },
  { value: "name", label: "Nome" },
  { value: "username", label: "Usuário" },
  { value: "cpuPercent", label: "CPU" },
  { value: "ramMb", label: "RAM" },
  { value: "vramMb", label: "VRAM" },
  { value: "gpuUse", label: "GPU" },
  { value: "diskReadKbps", label: "Disco leitura" },
  { value: "diskWriteKbps", label: "Disco escrita" },
];

export const PROCESS_SUMMARY_SORT_OPTIONS: { value: ProcessSortKey; label: string }[] = [
  { value: "pid", label: "PID" },
  { value: "name", label: "Nome" },
  { value: "username", label: "Usuário" },
  { value: "avgCpuPercent", label: "CPU média" },
  { value: "maxCpuPercent", label: "CPU máxima" },
  { value: "avgRamMb", label: "RAM média" },
  { value: "maxRamMb", label: "RAM máxima" },
  { value: "avgVramMb", label: "VRAM média" },
  { value: "maxVramMb", label: "VRAM máxima" },
  { value: "avgGpuUse", label: "GPU média" },
  { value: "maxGpuUse", label: "GPU máxima" },
  { value: "avgDiskReadKbps", label: "Leitura média" },
  { value: "maxDiskReadKbps", label: "Leitura máxima" },
  { value: "avgDiskWriteKbps", label: "Escrita média" },
  { value: "maxDiskWriteKbps", label: "Escrita máxima" },
];

function snapshotSortValue(row: TelemetryProcessSnapshot, key: ProcessSortKey): string | number {
  switch (key) {
    case "pid":
      return row.pid;
    case "name":
      return row.name.toLowerCase();
    case "username":
      return row.username.toLowerCase();
    case "cpuPercent":
      return row.cpuPercent ?? -1;
    case "ramMb":
      return row.ramMb ?? -1;
    case "vramMb":
      return row.vramMb ?? -1;
    case "gpuUse":
      return row.gpuUse ?? -1;
    case "diskReadKbps":
      return row.diskReadKbps ?? -1;
    case "diskWriteKbps":
      return row.diskWriteKbps ?? -1;
    default:
      return row.cpuPercent ?? -1;
  }
}

function summarySortValue(row: ProcessSessionSummary, key: ProcessSortKey): string | number {
  switch (key) {
    case "pid":
      return row.pid;
    case "name":
      return row.name.toLowerCase();
    case "username":
      return row.username.toLowerCase();
    case "avgCpuPercent":
      return row.avgCpuPercent ?? -1;
    case "maxCpuPercent":
      return row.maxCpuPercent ?? -1;
    case "avgRamMb":
      return row.avgRamMb ?? -1;
    case "maxRamMb":
      return row.maxRamMb ?? -1;
    case "avgVramMb":
      return row.avgVramMb ?? -1;
    case "maxVramMb":
      return row.maxVramMb ?? -1;
    case "avgGpuUse":
      return row.avgGpuUse ?? -1;
    case "maxGpuUse":
      return row.maxGpuUse ?? -1;
    case "avgDiskReadKbps":
      return row.avgDiskReadKbps ?? -1;
    case "maxDiskReadKbps":
      return row.maxDiskReadKbps ?? -1;
    case "avgDiskWriteKbps":
      return row.avgDiskWriteKbps ?? -1;
    case "maxDiskWriteKbps":
      return row.maxDiskWriteKbps ?? -1;
    default:
      return row.maxCpuPercent ?? -1;
  }
}

export function sortProcessSnapshots(
  rows: TelemetryProcessSnapshot[],
  key: ProcessSortKey,
  dir: ProcessSortDir,
): TelemetryProcessSnapshot[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = snapshotSortValue(a, key);
    const bv = snapshotSortValue(b, key);
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv, "pt-BR") * factor;
    }
    return ((av as number) - (bv as number)) * factor;
  });
}

export function sortProcessSummaries(
  rows: ProcessSessionSummary[],
  key: ProcessSortKey,
  dir: ProcessSortDir,
): ProcessSessionSummary[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = summarySortValue(a, key);
    const bv = summarySortValue(b, key);
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv, "pt-BR") * factor;
    }
    return ((av as number) - (bv as number)) * factor;
  });
}

export function fmtProcessPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function fmtProcessMb(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)} MB`;
}

export function fmtProcessKbps(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)} Kbps`;
}

export function fmtAvgMaxPct(
  avg: number | null | undefined,
  max: number | null | undefined,
): string {
  if (avg == null && max == null) return "—";
  return `${fmtProcessPct(avg)} / ${fmtProcessPct(max)}`;
}

export function fmtAvgMaxMb(
  avg: number | null | undefined,
  max: number | null | undefined,
): string {
  if (avg == null && max == null) return "—";
  return `${fmtProcessMb(avg)} / ${fmtProcessMb(max)}`;
}

export function fmtAvgMaxKbps(
  avg: number | null | undefined,
  max: number | null | undefined,
): string {
  if (avg == null && max == null) return "—";
  return `${fmtProcessKbps(avg)} / ${fmtProcessKbps(max)}`;
}

/** Última amostra do lote com lista de processos. */
export function pickLatestProcessesFromBatch(
  batch: { processes?: TelemetryProcessSnapshot[] | null }[],
): TelemetryProcessSnapshot[] | null {
  for (let i = batch.length - 1; i >= 0; i--) {
    const procs = batch[i]?.processes;
    if (procs && procs.length > 0) return procs;
  }
  return null;
}
