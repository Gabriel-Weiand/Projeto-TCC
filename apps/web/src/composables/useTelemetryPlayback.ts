import { ref, onUnmounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { RealtimeTelemetry } from "@/types";

export function useTelemetryPlayback(machineId: number) {
  const POLL_INTERVAL_MS = 10_000;

  const current = ref<RealtimeTelemetry | null>(null);
  const isActive = ref(false);

  const machinesStore = useMachinesStore();

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let playbackTimers: ReturnType<typeof setTimeout>[] = [];
  let lastSeenTime = 0;

  async function fetchLatest() {
    try {
      const result = await machinesStore.fetchTelemetryStream(machineId, 15);
      const rawEntries = Array.isArray(result) ? result : result?.entries;
      if (!rawEntries || rawEntries.length === 0) return;

      const sortedEntries = [...rawEntries].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const newEntries = sortedEntries.filter(
        (e) => new Date(e.timestamp).getTime() > lastSeenTime,
      );

      if (newEntries.length > 0) {
        scheduleBatch(newEntries);
      }
    } catch {
      // Ignora falhas de rede silenciosamente
    }
  }

  function scheduleBatch(entries: RealtimeTelemetry[]) {
    const firstEntry = entries[0];
    if (!firstEntry) return;

    playbackTimers.forEach(clearTimeout);
    playbackTimers = [];

    const baseTime = new Date(firstEntry.timestamp).getTime();

    // Fallback caso a API mande um batch com apenas 1 item
    if (entries.length === 1) {
      current.value = firstEntry;
      lastSeenTime = baseTime;
      return;
    }

    entries.forEach((telemetry, index) => {
      const itemTime = new Date(telemetry.timestamp).getTime();
      let delayMs = itemTime - baseTime;

      // Se der NaN ou se o agente por acaso mandar tempos idênticos,
      // força o intervalo mínimo exigido de 1 segundo (1000ms) entre os frames
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
    playbackTimers.forEach(clearTimeout);
    playbackTimers = [];
    pollTimer = null;
    lastSeenTime = 0;
  }

  onUnmounted(stop);

  return {
    current,
    isActive,
    start,
    stop,
  };
}
