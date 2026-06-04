import type { AllocationLifecycleStatus } from "@/types";
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

/** Duração menor que `minDurationMinutes` (alinhado à API). */
export function periodTooShortMessage(minDurationMinutes: number): string {
  return `A reserva deve ter pelo menos ${minDurationMinutes} minutos de duração.`;
}

/** Mensagem da API em POST/PATCH de alocação (400/409/422). */
export function allocationApiErrorMessage(
  err: unknown,
  fallback = "Erro ao processar a reserva.",
): string {
  const res = (
    err as {
      response?: { status?: number; data?: { code?: string; message?: string } };
    }
  )?.response;
  const status = res?.status;
  const code = res?.data?.code;
  const msg = res?.data?.message;

  if (status === 409) return "Conflito de horário com outra reserva.";
  if (status === 400 || status === 422) {
    if (code === "ALLOCATION_TOO_FAR") return PERIOD_END_TOO_FAR_MESSAGE;
    if (code === "ALLOCATION_TOO_SHORT" && msg) return msg;
    if (code === "INVALID_RANGE") return PERIOD_INVALID_RANGE_MESSAGE;
    if (msg) return msg;
  }
  return fallback;
}

/** Fases operacionais exibidas como «Aprovada» na listagem do usuário. */
const OPERATIONAL_APPROVED_LIFECYCLES = new Set([
  "approved",
  "active",
  "grace",
  "sftp",
]);

/**
 * Chave de exibição na listagem: agrupa aprovada, ativa, grace e SFTP.
 * Sessões encerradas (lifecycle finished) aparecem como finalizada.
 */
export function allocationListStatusKey(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
): string {
  if (status === "finished" || lifecycleStatus === "finished") return "finished";
  if (
    status === "approved" ||
    (lifecycleStatus && OPERATIONAL_APPROVED_LIFECYCLES.has(lifecycleStatus))
  ) {
    return "approved";
  }
  return status;
}

export function allocationListStatusBadge(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
): string {
  return allocationStatusBadge(
    allocationListStatusKey(status, lifecycleStatus),
  );
}

export function allocationListStatusLabel(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
): string {
  return allocationStatusLabel(
    allocationListStatusKey(status, lifecycleStatus),
  );
}

/** Chave de exibição no painel admin (sub-estados operacionais + removidas). */
export function adminAllocationStatusKey(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
  userHidden?: boolean,
): string {
  if (userHidden) return "removed";
  if (status === "approved") {
    const lc = lifecycleStatus ?? "approved";
    if (lc === "active" || lc === "grace" || lc === "sftp") return lc;
    if (lc === "finished") return "finished";
    return "approved";
  }
  return status;
}

export function adminAllocationStatusBadge(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
  userHidden?: boolean,
): string {
  const key = adminAllocationStatusKey(status, lifecycleStatus, userHidden);
  if (key === "removed") return "badge-muted";
  return allocationStatusBadge(
    status,
    key !== status ? key : undefined,
  );
}

export function adminAllocationStatusLabel(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
  userHidden?: boolean,
): string {
  const key = adminAllocationStatusKey(status, lifecycleStatus, userHidden);
  if (key === "removed") return "Removida";
  return allocationStatusLabel(
    status,
    key !== status ? key : undefined,
  );
}

export function allocationStatusBadge(
  status: string,
  lifecycleStatus?: string,
): string {
  const key = lifecycleStatus ?? status;
  const map: Record<string, string> = {
    pending: "badge-warning",
    approved: "badge-success",
    active: "badge-success",
    grace: "badge-warning",
    sftp: "badge-info",
    denied: "badge-danger",
    cancelled: "badge-muted",
    finished: "badge-info",
  };
  return map[key] || "badge-muted";
}

export function allocationStatusLabel(
  status: string,
  lifecycleStatus?: string,
): string {
  const key = lifecycleStatus ?? status;
  const map: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovada",
    active: "Ativa",
    grace: "Grace",
    sftp: "SFTP",
    denied: "Negada",
    cancelled: "Cancelada",
    finished: "Finalizada",
  };
  return map[key] || key;
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
