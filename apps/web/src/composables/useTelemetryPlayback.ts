import { ref, onUnmounted, watch, computed, type MaybeRefOrGetter, toValue } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { RealtimeTelemetry, TelemetryProcessSnapshot } from "@/types";
import {
  TELEMETRY_STREAM_BATCH_MAX,
  diffTelemetryBatches,
  sortTelemetryByTimestamp,
  telemetryStepDelaysMs,
  telemetryTimestampMs,
} from "@/utils/telemetryBatchDiff";
import { pickLatestProcessesFromBatch } from "@/utils/processTelemetry";

const POLL_INTERVAL_MS = 3_000;
const STALE_BATCH_MS = POLL_INTERVAL_MS * 3;
const MAX_STEP_MS = 60_000;

export function useTelemetryPlayback(machineId: MaybeRefOrGetter<number>) {
  const current = ref<RealtimeTelemetry | null>(null);
  const latestBatch = ref<RealtimeTelemetry[]>([]);
  const isActive = ref(false);

  const machinesStore = useMachinesStore();

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let playbackTimers: ReturnType<typeof setTimeout>[] = [];
  let pendingPlayback = false;
  let lastDisplayedMs = 0;
  let previousBatch: RealtimeTelemetry[] = [];
  const scheduledTimestamps = new Set<string>();

  function resolvedId(): number {
    return toValue(machineId);
  }

  function cancelPendingPlayback() {
    playbackTimers.forEach(clearTimeout);
    playbackTimers = [];
    pendingPlayback = false;
  }

  function resetPlaybackState() {
    cancelPendingPlayback();
    scheduledTimestamps.clear();
    lastDisplayedMs = 0;
    previousBatch = [];
    current.value = null;
    latestBatch.value = [];
  }

  /** Atualiza só se o timestamp for >= ao já exibido (nunca volta no tempo). */
  function commitIfNewer(
    telemetry: RealtimeTelemetry,
    options?: { cancelTimers?: boolean },
  ): boolean {
    const ts = telemetryTimestampMs(telemetry.timestamp);
    if (ts < lastDisplayedMs) return false;
    if (options?.cancelTimers) cancelPendingPlayback();
    current.value = telemetry;
    lastDisplayedMs = ts;
    return true;
  }

  function markSeen(entries: readonly RealtimeTelemetry[]) {
    for (const e of entries) scheduledTimestamps.add(e.timestamp);
  }

  /**
   * Reproduz amostras novas respeitando o intervalo entre coletas no agente.
   * Não cancela timers já agendados — só adiciona timestamps ainda não programados.
   */
  function schedulePlayback(entries: RealtimeTelemetry[]) {
    const sorted = sortTelemetryByTimestamp(entries).filter((e) => {
      const ts = telemetryTimestampMs(e.timestamp);
      return !scheduledTimestamps.has(e.timestamp) && ts > lastDisplayedMs;
    });
    if (!sorted.length) return;

    const latestTs = telemetryTimestampMs(
      sorted[sorted.length - 1]!.timestamp,
    );
    if (Date.now() - latestTs > STALE_BATCH_MS) {
      commitIfNewer(sorted[sorted.length - 1]!, { cancelTimers: true });
      markSeen(sorted);
      return;
    }

    if (sorted.length === 1) {
      commitIfNewer(sorted[0]!, { cancelTimers: true });
      scheduledTimestamps.add(sorted[0]!.timestamp);
      return;
    }

    const delays = telemetryStepDelaysMs(sorted, MAX_STEP_MS);
    let accumulated = 0;
    pendingPlayback = true;

    sorted.forEach((telemetry, index) => {
      if (index > 0) accumulated += delays[index] ?? 1000;

      scheduledTimestamps.add(telemetry.timestamp);

      const timer = setTimeout(() => {
        commitIfNewer(telemetry);
        if (index === sorted.length - 1) pendingPlayback = false;
      }, accumulated);

      playbackTimers.push(timer);
    });
  }

  async function fetchLatest() {
    try {
      const id = resolvedId();
      const result = await machinesStore.fetchTelemetryStream(
        id,
        TELEMETRY_STREAM_BATCH_MAX,
      );

      const rawBatch = result.batch ?? result.entries ?? [];
      if (!rawBatch.length) {
        if (result.latest) commitIfNewer(result.latest);
        latestBatch.value = result.latest ? [result.latest] : [];
        return;
      }

      const sortedBatch = sortTelemetryByTimestamp(rawBatch);
      latestBatch.value = sortedBatch;

      if (previousBatch.length === 0) {
        const latest = sortedBatch[sortedBatch.length - 1]!;
        commitIfNewer(latest, { cancelTimers: true });
        previousBatch = sortedBatch;
        markSeen(sortedBatch);
        return;
      }

      const delta = diffTelemetryBatches(previousBatch, sortedBatch);
      previousBatch = sortedBatch;

      if (delta.length === 0) {
        const latest = sortedBatch[sortedBatch.length - 1]!;
        const latestMs = telemetryTimestampMs(latest.timestamp);
        if (!pendingPlayback && latestMs > lastDisplayedMs) {
          commitIfNewer(latest, { cancelTimers: true });
        }
        return;
      }

      schedulePlayback(delta);
    } catch {
      /* ignore */
    }
  }

  function start() {
    if (isActive.value) return;
    isActive.value = true;
    fetchLatest();
    pollTimer = setInterval(fetchLatest, POLL_INTERVAL_MS);
  }

  function stop() {
    isActive.value = false;
    if (pollTimer) clearInterval(pollTimer);
    resetPlaybackState();
    pollTimer = null;
  }

  function restart() {
    const wasActive = isActive.value;
    stop();
    if (wasActive) start();
  }

  watch(
    () => toValue(machineId),
    (nextId, prevId) => {
      if (prevId !== undefined && nextId !== prevId) {
        restart();
      }
    },
  );

  onUnmounted(stop);

  const latestProcesses = computed<TelemetryProcessSnapshot[] | null>(() =>
    pickLatestProcessesFromBatch(latestBatch.value),
  );

  const latestProcessBatchTimestamp = computed<string | null>(() => {
    for (let i = latestBatch.value.length - 1; i >= 0; i--) {
      const row = latestBatch.value[i];
      if (row?.processes?.length) return row.timestamp;
    }
    return null;
  });

  const latestBatchTimestamp = computed<string | null>(() => {
    const batch = latestBatch.value;
    if (!batch.length) return null;
    return batch[batch.length - 1]?.timestamp ?? null;
  });

  return {
    current,
    latestBatch,
    latestProcesses,
    latestProcessBatchTimestamp,
    latestBatchTimestamp,
    isActive,
    start,
    stop,
    restart,
  };
}
