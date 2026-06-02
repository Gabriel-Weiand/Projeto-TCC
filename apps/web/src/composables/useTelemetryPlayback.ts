import { ref, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { RealtimeTelemetry } from "@/types";

export function useTelemetryPlayback(machineId: MaybeRefOrGetter<number>) {
  const POLL_INTERVAL_MS = 10_000;

  const current = ref<RealtimeTelemetry | null>(null);
  const isActive = ref(false);

  const machinesStore = useMachinesStore();

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let playbackTimers: ReturnType<typeof setTimeout>[] = [];
  let lastSeenTime = 0;

  function resolvedId(): number {
    return toValue(machineId);
  }

  function resetPlaybackState() {
    playbackTimers.forEach(clearTimeout);
    playbackTimers = [];
    lastSeenTime = 0;
    current.value = null;
  }

  async function fetchLatest() {
    try {
      const id = resolvedId();
      const result = await machinesStore.fetchTelemetryStream(id, 15);
      const rawEntries = Array.isArray(result) ? result : result?.entries;
      if (!rawEntries || rawEntries.length === 0) return;

      const sortedEntries = [...rawEntries].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const latest = sortedEntries[sortedEntries.length - 1];
      const newEntries = sortedEntries.filter(
        (e) => new Date(e.timestamp).getTime() > lastSeenTime,
      );

      if (newEntries.length > 0) {
        scheduleBatch(newEntries);
      } else if (latest) {
        current.value = latest;
      }
    } catch {
      /* ignore */
    }
  }

  function scheduleBatch(entries: RealtimeTelemetry[]) {
    const firstEntry = entries[0];
    if (!firstEntry) return;

    playbackTimers.forEach(clearTimeout);
    playbackTimers = [];

    const baseTime = new Date(firstEntry.timestamp).getTime();

    if (entries.length === 1) {
      current.value = firstEntry;
      lastSeenTime = baseTime;
      return;
    }

    entries.forEach((telemetry, index) => {
      const itemTime = new Date(telemetry.timestamp).getTime();
      let delayMs = itemTime - baseTime;

      if (isNaN(delayMs) || (index > 0 && delayMs === 0)) {
        delayMs = index * 1000;
      }

      const timer = setTimeout(() => {
        current.value = telemetry;
        lastSeenTime = Math.max(lastSeenTime, itemTime);
      }, delayMs);

      playbackTimers.push(timer);
    });
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

  return {
    current,
    isActive,
    start,
    stop,
    restart,
  };
}
