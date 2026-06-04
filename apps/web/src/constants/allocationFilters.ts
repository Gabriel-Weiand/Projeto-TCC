/** Filtros de status compartilhados (usuário e admin). */
export const ALLOCATION_STATUS_FILTER_TABS = [
  { key: "all", label: "Todas" },
  { key: "pending", label: "Pendentes" },
  /** Agrupa status approved no banco + fases operacionais (ativa, grace, SFTP). */
  { key: "approved", label: "Aprovadas" },
  { key: "denied", label: "Negadas" },
  { key: "finished", label: "Finalizadas" },
  { key: "cancelled", label: "Canceladas" },
] as const;

export const ADMIN_ALLOCATION_FILTER_TABS = [
  ...ALLOCATION_STATUS_FILTER_TABS,
  { key: "hidden", label: "Removidas pelo usuário" },
] as const;

export type AllocationStatusFilterKey =
  (typeof ALLOCATION_STATUS_FILTER_TABS)[number]["key"];

export type AdminAllocationFilterKey =
  (typeof ADMIN_ALLOCATION_FILTER_TABS)[number]["key"];

export function isHiddenAllocationsFilter(key: string): boolean {
  return key === "hidden";
}

/**
 * Parâmetros da API: «approved» usa status=approved (inclui agendada, ativa, grace e SFTP).
 * Filtros por lifecycleStatus (active/grace/sftp) foram removidos da UI de propósito.
 */
export function allocationFilterParams(
  key: string,
): Record<string, string | boolean | number> | undefined {
  if (key === "all") return undefined;
  if (isHiddenAllocationsFilter(key)) {
    return { userHidden: true, limit: 100 };
  }
  return { status: key, limit: 100 };
}

/** Exclui sessões já encerradas (lifecycle finished) da aba «Aprovadas». */
export function refineApprovedFilterResults<T extends { status: string }>(
  rows: T[],
  filterKey: string,
  lifecycleOf: (a: T) => string,
): T[] {
  if (filterKey !== "approved") return rows;
  return rows.filter(
    (a) => a.status === "approved" && lifecycleOf(a) !== "finished",
  );
}
