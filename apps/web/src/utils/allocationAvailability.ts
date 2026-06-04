import type { Allocation, Machine } from "@/types";
import { normalizeApiUtcIso, parseApiUtcMs } from "@/utils/datetime";

const BLOCKING_STATUSES = new Set<Allocation["status"]>(["approved", "pending"]);

export function isMachineStatusBlocked(status: Machine["status"]): boolean {
  return status === "offline" || status === "disabled" || status === "maintenance";
}

/** Conflito com reserva aprovada ou pendente na mesma máquina. */
export function machineHasAllocationConflict(
  allocations: Allocation[],
  machineId: number,
  startIso: string,
  endIso: string,
): boolean {
  const startMs = parseApiUtcMs(normalizeApiUtcIso(startIso));
  const endMs = parseApiUtcMs(normalizeApiUtcIso(endIso));
  return allocations.some((a) => {
    if (a.machineId !== machineId || !BLOCKING_STATUSES.has(a.status)) {
      return false;
    }
    const aStart = parseApiUtcMs(normalizeApiUtcIso(a.startTime));
    const aEnd = parseApiUtcMs(normalizeApiUtcIso(a.endTime));
    return aStart < endMs && aEnd > startMs;
  });
}

export function isMachineAvailableForPeriod(
  machine: Machine | undefined,
  allocations: Allocation[],
  startIso: string,
  endIso: string,
): boolean {
  if (!machine || isMachineStatusBlocked(machine.status)) return false;
  return !machineHasAllocationConflict(
    allocations,
    machine.id,
    startIso,
    endIso,
  );
}
