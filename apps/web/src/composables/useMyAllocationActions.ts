import type { Allocation } from "@/types";
import {
  isNowBeforeUtc,
  isNowInUtcRange,
  isNowWithinGraceAfterEnd,
} from "@/utils/datetime";

const DEFAULT_GRACE_MINUTES = 5;

export function useMyAllocationActions(graceMinutes = DEFAULT_GRACE_MINUTES) {
  function canCancel(a: Allocation) {
    return ["pending", "approved"].includes(a.status);
  }

  function showConnectButton(a: Allocation) {
    return a.status === "approved";
  }

  function canConnectNow(a: Allocation) {
    return (
      a.status === "approved" &&
      !isNowBeforeUtc(a.startTime) &&
      isNowInUtcRange(a.startTime, a.endTime)
    );
  }

  function connectDisabledTitle(a: Allocation): string | undefined {
    if (!showConnectButton(a)) return undefined;
    if (isNowBeforeUtc(a.startTime)) {
      return "Disponível após o horário de início";
    }
    if (!canConnectNow(a)) return "Fora do período da reserva";
    return "Conectar via SSH";
  }

  function showExtendButton(a: Allocation) {
    return (
      a.status === "approved" &&
      isNowWithinGraceAfterEnd(a.endTime, graceMinutes)
    );
  }

  function showStatistics(a: Allocation) {
    return a.status === "finished";
  }

  function canRemoveFromHistory(a: Allocation) {
    return ["finished", "cancelled", "denied"].includes(a.status);
  }

  function hasActions(a: Allocation) {
    return (
      canCancel(a) ||
      showConnectButton(a) ||
      showExtendButton(a) ||
      showStatistics(a) ||
      canRemoveFromHistory(a)
    );
  }

  return {
    canCancel,
    showConnectButton,
    canConnectNow,
    connectDisabledTitle,
    showExtendButton,
    showStatistics,
    canRemoveFromHistory,
    hasActions,
  };
}
