import type { Allocation, AllocationLifecycleStatus } from "@/types";
import {
  isNowInUtcRange,
  isNowWithinGraceAfterEnd,
  parseApiUtcMs,
} from "@/utils/datetime";

export type AllocationAccessTiming = {
  graceMinutes: number;
  postSftpMinutes: number;
};

/** Preferência: `lifecycleStatus` vindo da API; senão estimativa local. */
export function effectiveLifecycleStatus(
  a: Allocation,
  access: AllocationAccessTiming,
): AllocationLifecycleStatus {
  if (a.lifecycleStatus) return a.lifecycleStatus;
  return estimateLifecycleStatus(a, access);
}

export function estimateLifecycleStatus(
  a: Allocation,
  access: AllocationAccessTiming,
): AllocationLifecycleStatus {
  const s = a.status;
  if (s === "pending" || s === "denied" || s === "cancelled" || s === "finished") {
    return s;
  }
  if (s !== "approved") return "finished";

  const { graceMinutes, postSftpMinutes } = access;
  const now = Date.now();
  const start = a.startTime;
  const end = a.endTime;

  if (isNowInUtcRange(start, end, now)) return "active";
  if (isNowWithinGraceAfterEnd(end, graceMinutes, now)) return "grace";

  const endMs = parseApiUtcMs(end);
  const sftpEndMs = endMs + (graceMinutes + postSftpMinutes) * 60_000;
  if (now > endMs + graceMinutes * 60_000 && now <= sftpEndMs) return "sftp";
  if (now > sftpEndMs) return "finished";
  return "approved";
}

export function isSessionPhase(lifecycle: AllocationLifecycleStatus): boolean {
  return lifecycle === "active" || lifecycle === "grace" || lifecycle === "sftp";
}

/** Estender: antes do início (`approved`), durante bash (`active`/`grace`); não em SFTP. */
export function isExtendablePhase(lifecycle: AllocationLifecycleStatus): boolean {
  return (
    lifecycle === "approved" ||
    lifecycle === "active" ||
    lifecycle === "grace"
  );
}

export function isPostSessionPhase(lifecycle: AllocationLifecycleStatus): boolean {
  return lifecycle === "finished";
}
