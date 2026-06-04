import type { Allocation, AllocationLifecycleStatus } from "@/types";
import {
  isNowInUtcRange,
  isNowWithinGraceAfterEnd,
  isNowWithinSftpAfterGrace,
  parseApiUtcMs,
} from "@/utils/datetime";

export type AllocationAccessTiming = {
  graceMinutes: number;
  postSftpMinutes: number;
  graceEnabled?: boolean;
  postSftpEnabled?: boolean;
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
  const graceOn = access.graceEnabled ?? graceMinutes > 0;
  const sftpOn = access.postSftpEnabled ?? postSftpMinutes > 0;
  const now = Date.now();
  const start = a.startTime;
  const end = a.endTime;

  if (isNowInUtcRange(start, end, now)) return "active";
  if (graceOn && isNowWithinGraceAfterEnd(end, graceMinutes, now)) return "grace";
  if (sftpOn && isNowWithinSftpAfterGrace(end, graceMinutes, postSftpMinutes, now)) {
    return "sftp";
  }

  const endMs = parseApiUtcMs(end);
  const sftpEndMs = endMs + (graceMinutes + postSftpMinutes) * 60_000;
  if (now >= sftpEndMs) return "finished";
  return "approved";
}

export function isSessionPhase(lifecycle: AllocationLifecycleStatus): boolean {
  return lifecycle === "active" || lifecycle === "grace" || lifecycle === "sftp";
}

/** Estender: antes do início (`approved`), durante bash (`active`/`grace` se habilitado); não em SFTP. */
export function isExtendablePhase(
  lifecycle: AllocationLifecycleStatus,
  access?: Pick<AllocationAccessTiming, "graceEnabled" | "graceMinutes">,
): boolean {
  const graceOn =
    access?.graceEnabled ?? (access?.graceMinutes ?? 1) > 0;
  if (lifecycle === "grace" && !graceOn) return false;
  return (
    lifecycle === "approved" ||
    lifecycle === "active" ||
    lifecycle === "grace"
  );
}

export function isPostSessionPhase(lifecycle: AllocationLifecycleStatus): boolean {
  return lifecycle === "finished";
}
