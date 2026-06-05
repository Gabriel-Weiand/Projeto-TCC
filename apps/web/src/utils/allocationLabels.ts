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

/** Extensão: novo fim não é posterior ao fim atual da reserva. */
export const EXTEND_END_NOT_AFTER_CURRENT_MESSAGE =
  "A finalização deve ser posterior ao fim atual da reserva.";

/** Período sobrepõe outra reserva aprovada/pendente na mesma máquina. */
export const PERIOD_ALLOCATION_CONFLICT_MESSAGE =
  "O horário conflita com outra reserva nesta máquina.";

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

/**
 * Chave de exibição na listagem do usuário: sub-estados operacionais (ativa, grace, SFTP)
 * quando `status === approved`; demais status inalterados.
 */
export function allocationListStatusKey(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
  options?: { graceEnabled?: boolean; postSftpEnabled?: boolean },
): string {
  if (status === "finished" || lifecycleStatus === "finished") return "finished";
  if (status === "approved") {
    let lc: AllocationLifecycleStatus = lifecycleStatus ?? "approved";
    if (lc === "grace" && options?.graceEnabled === false) lc = "active";
    if (lc === "sftp" && options?.postSftpEnabled === false) lc = "finished";
    if (lc === "active" || lc === "grace" || lc === "sftp") return lc;
    if (lc === "finished") return "finished";
    return "approved";
  }
  return status;
}

export function allocationListStatusBadge(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
  options?: { graceEnabled?: boolean; postSftpEnabled?: boolean },
): string {
  const key = allocationListStatusKey(status, lifecycleStatus, options);
  return allocationStatusBadge(status, key !== status ? key : undefined);
}

export function allocationListStatusLabel(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
  options?: { graceEnabled?: boolean; postSftpEnabled?: boolean },
): string {
  const key = allocationListStatusKey(status, lifecycleStatus, options);
  return allocationStatusLabel(status, key !== status ? key : undefined);
}

/** Chave de exibição no painel admin (sub-estados operacionais + removidas). */
export function adminAllocationStatusKey(
  status: string,
  lifecycleStatus?: AllocationLifecycleStatus,
  userHidden?: boolean,
  options?: { graceEnabled?: boolean; postSftpEnabled?: boolean },
): string {
  if (userHidden) return "removed";
  if (status === "approved") {
    let lc: AllocationLifecycleStatus = lifecycleStatus ?? "approved";
    if (lc === "grace" && options?.graceEnabled === false) lc = "active";
    if (lc === "sftp" && options?.postSftpEnabled === false) lc = "finished";
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
  options?: { graceEnabled?: boolean; postSftpEnabled?: boolean },
): string {
  const key = adminAllocationStatusKey(status, lifecycleStatus, userHidden, options);
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
  options?: { graceEnabled?: boolean; postSftpEnabled?: boolean },
): string {
  const key = adminAllocationStatusKey(status, lifecycleStatus, userHidden, options);
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
