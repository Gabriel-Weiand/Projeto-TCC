import { computed } from "vue";
import type { Allocation } from "@/types";
import { useLabConfigStore } from "@/stores/labConfig";
import {
  effectiveLifecycleStatus,
  isExtendablePhase,
  isPostSessionPhase,
  isSessionPhase,
} from "@/utils/allocationLifecycle";
import { isNowBeforeUtc } from "@/utils/datetime";

export function useMyAllocationActions() {
  const lab = useLabConfigStore();
  const access = computed(() => lab.allocationAccess);

  function lifecycle(a: Allocation) {
    return effectiveLifecycleStatus(a, access.value);
  }

  function canCancel(a: Allocation) {
    const lc = lifecycle(a);
    return (
      (lc === "pending" || lc === "approved") && isNowBeforeUtc(a.startTime)
    );
  }

  function showConnectButton(a: Allocation) {
    return isSessionPhase(lifecycle(a));
  }

  function canConnectNow(a: Allocation) {
    return showConnectButton(a);
  }

  function connectDisabledTitle(a: Allocation): string | undefined {
    if (!showConnectButton(a)) return undefined;
    if (lifecycle(a) === "sftp") {
      return "Conectar via SFTP (somente transferência de arquivos)";
    }
    if (lifecycle(a) === "grace") {
      return "Conectar via SSH (período de encerramento)";
    }
    return "Conectar via SSH";
  }

  function connectPhaseNotice(a: Allocation): string | null {
    if (lifecycle(a) === "sftp") {
      return "Neste período o acesso é apenas para transferência de arquivos via SFTP (sem terminal bash).";
    }
    return null;
  }

  function showExtendButton(a: Allocation) {
    return a.status === "approved" && isExtendablePhase(lifecycle(a));
  }

  function showFinishButton(a: Allocation) {
    return isSessionPhase(lifecycle(a));
  }

  function finishConfirmMessage(): string {
    return (
      "Finalizar a sessão agora?\n\n" +
      "O acesso bash encerra em seguida. Os períodos de grace e SFTP pós-sessão também serão pulados."
    );
  }

  function showStatistics(a: Allocation) {
    return isPostSessionPhase(lifecycle(a));
  }

  function canRemoveFromHistory(a: Allocation) {
    const lc = lifecycle(a);
    return lc === "finished" || lc === "cancelled" || lc === "denied";
  }

  function hasActions(a: Allocation) {
    return (
      canCancel(a) ||
      showConnectButton(a) ||
      showExtendButton(a) ||
      showFinishButton(a) ||
      showStatistics(a) ||
      canRemoveFromHistory(a)
    );
  }

  return {
    canCancel,
    showConnectButton,
    canConnectNow,
    connectDisabledTitle,
    connectPhaseNotice,
    showExtendButton,
    showFinishButton,
    finishConfirmMessage,
    showStatistics,
    canRemoveFromHistory,
    hasActions,
    lifecycle,
  };
}
