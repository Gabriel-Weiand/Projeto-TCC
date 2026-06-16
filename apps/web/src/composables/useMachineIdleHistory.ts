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
const SPARSE_CHECK_INTERVAL_MS = 5_000;
const SPARSE_CHART_POINT_THRESHOLD = 4;

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
  options?: {
    enabled?: MaybeRefOrGetter<boolean>;
    /** Atualiza o gráfico quando a telemetria ao vivo muda (ex.: novo lote do agente). */
    liveStamp?: MaybeRefOrGetter<string | null | undefined>;
  },
) {
  const chartSeries = ref<AllocationChartPoint[]>([]);
  const meta = ref<MachineIdleHistoryMeta | null>(null);
  const loading = ref(false);
  const error = ref("");

  const machinesStore = useMachinesStore();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSignature = "";

  function pollIntervalMs(): number {
    const count = meta.value?.chartPointCount ?? chartSeries.value.length;
    return count < SPARSE_CHART_POINT_THRESHOLD
      ? SPARSE_CHECK_INTERVAL_MS
      : CHECK_INTERVAL_MS;
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      await refresh();
      if (isEnabled()) schedulePoll();
    }, pollIntervalMs());
  }

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
    void refresh({ force: true }).finally(() => {
      if (isEnabled()) schedulePoll();
    });
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
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

  watch(
    () => (options?.liveStamp === undefined ? null : toValue(options.liveStamp)),
    (stamp, prev) => {
      if (!stamp || stamp === prev || !isEnabled()) return;
      void refresh();
    },
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
