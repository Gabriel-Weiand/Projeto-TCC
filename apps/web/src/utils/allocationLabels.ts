import {
  formatLabDate,
  formatLabDateTime,
  formatLabTime,
} from "@/utils/datetime";

/** Limite do campo motivo (alinhado à API). */
export const ALLOCATION_REASON_MAX_LENGTH = 200;

/** Período preenchido com início/fim incoerentes (ex.: término antes do início). */
export const PERIOD_INVALID_RANGE_MESSAGE =
  "Horário inadequado para o período selecionado.";

/** Data/hora de término além do limite futuro do laboratório. */
export const PERIOD_END_TOO_FAR_MESSAGE =
  "Datas inválidas para o período selecionado.";

export function allocationStatusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: "badge-warning",
    approved: "badge-success",
    denied: "badge-danger",
    cancelled: "badge-muted",
    finished: "badge-info",
  };
  return map[status] || "badge-muted";
}

export function allocationStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovada",
    denied: "Negada",
    cancelled: "Cancelada",
    finished: "Finalizada",
  };
  return map[status] || status;
}

/** @deprecated use formatLabDateTime(iso, labTz) */
export function fmtAllocationDate(iso: string): string {
  return formatLabDate(iso);
}

/** @deprecated use formatLabTime(iso, labTz) */
export function fmtAllocationTime(iso: string): string {
  return formatLabTime(iso);
}

export function fmtAllocationDateTime(iso: string, timeZone?: string): string {
  return formatLabDateTime(iso, timeZone);
}
