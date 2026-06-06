import {
  onUnmounted,
  ref,
  watch,
  type MaybeRefOrGetter,
  toValue,
} from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { AllocationChartPoint, MachineIdleHistoryMeta } from "@/types";

/** Verifica se há dados novos; alinhado ao heartbeat do agente (~30 s). */
const CHECK_INTERVAL_MS = 30_000;

function idleHistorySignature(
  meta: MachineIdleHistoryMeta | null,
): string {
  if (!meta) return "";
  return [
    meta.pointCount,
    meta.chartPointCount,
    meta.lastBufferTimestamp ?? "",
    meta.lastChartTimestamp ?? "",
  ].join("|");
}

export function useMachineIdleHistory(
  machineId: MaybeRefOrGetter<number>,
  options?: { enabled?: MaybeRefOrGetter<boolean> },
) {
  const chartSeries = ref<AllocationChartPoint[]>([]);
  const meta = ref<MachineIdleHistoryMeta | null>(null);
  const loading = ref(false);
  const error = ref("");

  const machinesStore = useMachinesStore();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastSignature = "";

  function isEnabled(): boolean {
    return options?.enabled === undefined ? true : Boolean(toValue(options.enabled));
  }

  async function refresh(options?: { force?: boolean }) {
    if (!isEnabled()) return;
    try {
      const data = await machinesStore.fetchMachineIdleHistory(toValue(machineId));
      const signature = idleHistorySignature(data.meta ?? null);

      if (!options?.force && signature === lastSignature && chartSeries.value.length > 0) {
        return;
      }

      lastSignature = signature;
      chartSeries.value = data.chartSeries ?? [];
      meta.value = data.meta ?? null;
      error.value = "";
    } catch {
      error.value = "Não foi possível carregar o histórico de telemetria.";
    } finally {
      loading.value = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    loading.value = chartSeries.value.length === 0;
    lastSignature = "";
    void refresh({ force: true });
    pollTimer = setInterval(() => void refresh(), CHECK_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    lastSignature = "";
  }

  watch(
    () => [toValue(machineId), isEnabled()] as const,
    ([id, enabled]) => {
      stopPolling();
      chartSeries.value = [];
      meta.value = null;
      error.value = "";
      if (id && enabled) startPolling();
    },
    { immediate: true },
  );

  onUnmounted(stopPolling);

  return {
    chartSeries,
    meta,
    loading,
    error,
    refresh: () => refresh({ force: true }),
  };
}
