import type { Allocation } from "@/types";
import { isPostSessionPhase } from "@/utils/allocationLifecycle";
import type { AllocationLifecycleStatus } from "@/types";

export function useAdminAllocationActions(
  lifecycle: (a: Allocation) => AllocationLifecycleStatus,
) {
  function canApproveDeny(a: Allocation) {
    return a.status === "pending";
  }

  function canCancel(a: Allocation) {
    return a.status === "approved";
  }

  function canGenerateSummary(a: Allocation) {
    if (a.status === "pending") return false;
    if (a.metric) return false;
    return isPostSessionPhase(lifecycle(a)) || a.status === "finished";
  }

  function canViewStatistics(a: Allocation) {
    return !!a.metric;
  }

  function canDelete(a: Allocation) {
    return (
      a.userHidden ||
      a.status === "cancelled" ||
      a.status === "finished" ||
      a.status === "denied"
    );
  }

  function hasActions(a: Allocation, readonly = false) {
    if (readonly) return canDelete(a);
    return (
      canApproveDeny(a) ||
      canCancel(a) ||
      canGenerateSummary(a) ||
      canViewStatistics(a) ||
      canDelete(a)
    );
  }

  return {
    canApproveDeny,
    canCancel,
    canGenerateSummary,
    canViewStatistics,
    canDelete,
    hasActions,
  };
}
