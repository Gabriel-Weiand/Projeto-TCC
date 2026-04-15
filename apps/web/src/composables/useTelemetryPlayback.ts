import { ref, onUnmounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { RealtimeTelemetry } from "@/types";

/**
 * Composable para telemetria em tempo real.
 *
 * Busca o último estado de telemetria a cada POLL_INTERVAL_MS
 * e atualiza `current` imediatamente. Sem fila de replay —
 * mostra sempre o dado mais recente do servidor.
 *
 * Latência esperada: agente envia a cada 5s + poll a cada 5s = ~10s max.
 */
export function useTelemetryPlayback(machineId: number) {
  const POLL_INTERVAL_MS = 5_000; // Poll a cada 5s (mesmo ritmo do agente)

  const current = ref<RealtimeTelemetry | null>(null);
  const isActive = ref(false);

  const machinesStore = useMachinesStore();

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function fetchLatest() {
    try {
      const result = await machinesStore.fetchTelemetryStream(machineId, 1);
      const last = result.entries[result.entries.length - 1];
      if (last) {
        current.value = last;
      }
    } catch {
      // silently ignore fetch errors
    }
  }

  function start() {
    if (isActive.value) return;
    isActive.value = true;

    // Fetch imediato
    fetchLatest();

    // Poll a cada 5s
    pollTimer = setInterval(fetchLatest, POLL_INTERVAL_MS);
  }

  function stop() {
    isActive.value = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  onUnmounted(stop);

  return {
    current,
    isActive,
    start,
    stop,
  };
}
