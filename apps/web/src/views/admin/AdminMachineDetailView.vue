<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMachinesStore } from "@/stores/machines";
import { useAllocationsStore } from "@/stores/allocations";
import { useTelemetryPlayback } from "@/composables/useTelemetryPlayback";
import type { Machine, Allocation } from "@/types";

const route = useRoute();
const router = useRouter();
const machinesStore = useMachinesStore();
const allocationsStore = useAllocationsStore();

const machineId = Number(route.params.id);
const machine = ref<Machine | null>(null);
const allocations = ref<Allocation[]>([]);
const loading = ref(true);

// Telemetry playback (1/s)
const {
  current: telemetry,
  start: startPlayback,
  stop: stopPlayback,
} = useTelemetryPlayback(machineId);

let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  try {
    const [m, allocs] = await Promise.all([
      machinesStore.fetchMachine(machineId),
      machinesStore.fetchMachineAllocations(machineId, { limit: 20 }),
    ]);
    machine.value = m;
    allocations.value = allocs.data || [];

    // Start telemetry playback
    startPlayback();

    // Auto-refresh allocations every 30s
    refreshInterval = setInterval(async () => {
      try {
        const allocs = await machinesStore.fetchMachineAllocations(machineId, {
          limit: 20,
        });
        allocations.value = allocs.data || [];
      } catch {
        // silently ignore
      }
    }, 30_000);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  stopPlayback();
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
});

// Telemetry display helpers
const liveData = computed(() => {
  // Prefer playback data, fallback to machine's latestTelemetry
  return telemetry.value || machine.value?.latestTelemetry || null;
});

function usageColor(val: number | null | undefined): string {
  if (val == null) return "var(--text-muted)";
  if (val < 50) return "var(--success)";
  if (val < 80) return "var(--warning)";
  return "var(--danger)";
}

function tempColor(val: number | null | undefined): string {
  if (val == null) return "var(--text-muted)";
  if (val < 60) return "var(--success)";
  if (val < 80) return "var(--warning)";
  return "var(--danger)";
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    available: "badge-success",
    occupied: "badge-warning",
    maintenance: "badge-info",
    offline: "badge-danger",
  };
  return map[s] || "badge-muted";
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    available: "Disponível",
    occupied: "Ocupada",
    maintenance: "Manutenção",
    offline: "Offline",
  };
  return map[s] || s;
}

function allocStatusBadge(s: string) {
  const map: Record<string, string> = {
    pending: "badge-warning",
    approved: "badge-success",
    denied: "badge-danger",
    cancelled: "badge-muted",
    finished: "badge-info",
  };
  return map[s] || "badge-muted";
}

function allocStatusLabel(s: string) {
  const map: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovada",
    denied: "Negada",
    cancelled: "Cancelada",
    finished: "Finalizada",
  };
  return map[s] || s;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function handleStatusChange(alloc: Allocation, status: string) {
  try {
    const updated = await allocationsStore.updateAllocation(alloc.id, {
      status,
    });
    const idx = allocations.value.findIndex((a) => a.id === alloc.id);
    if (idx !== -1) allocations.value[idx] = updated;
  } catch {
    alert("Erro ao atualizar alocação.");
  }
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <button class="btn btn-ghost btn-sm" @click="router.back()">
        ← Voltar
      </button>
      <h1 class="page-title" v-if="machine">
        {{ machine.name }}
        <span
          :class="['badge', statusBadge(machine.status)]"
          style="font-size: 0.75rem; margin-left: 0.5rem"
        >
          {{ statusLabel(machine.status) }}
        </span>
      </h1>
    </div>

    <div v-if="loading" class="empty-state">Carregando...</div>

    <template v-else-if="machine">
      <!-- ═══ TELEMETRIA LIVE ═══ -->
      <h2 class="section-title">Telemetria em Tempo Real</h2>

      <div v-if="liveData" class="telemetry-grid">
        <!-- CPU -->
        <div class="tele-card">
          <span class="tele-label">CPU</span>
          <div
            class="tele-value"
            :style="{ color: usageColor(liveData.cpuUsage) }"
          >
            {{ liveData.cpuUsage?.toFixed(1) ?? "—" }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: (liveData.cpuUsage ?? 0) + '%',
                background: usageColor(liveData.cpuUsage),
              }"
            ></div>
          </div>
          <span
            class="tele-sub"
            :style="{ color: tempColor(liveData.cpuTemp) }"
          >
            {{ liveData.cpuTemp?.toFixed(1) ?? "—" }} °C
          </span>
        </div>

        <!-- GPU -->
        <div class="tele-card">
          <span class="tele-label">GPU</span>
          <div
            class="tele-value"
            :style="{ color: usageColor(liveData.gpuUsage) }"
          >
            {{ liveData.gpuUsage?.toFixed(1) ?? "—" }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: (liveData.gpuUsage ?? 0) + '%',
                background: usageColor(liveData.gpuUsage),
              }"
            ></div>
          </div>
          <span
            class="tele-sub"
            :style="{ color: tempColor(liveData.gpuTemp) }"
          >
            {{ liveData.gpuTemp?.toFixed(1) ?? "—" }} °C
          </span>
        </div>

        <!-- RAM -->
        <div class="tele-card">
          <span class="tele-label">RAM</span>
          <div
            class="tele-value"
            :style="{ color: usageColor(liveData.ramUsage) }"
          >
            {{ liveData.ramUsage?.toFixed(1) ?? "—" }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: (liveData.ramUsage ?? 0) + '%',
                background: usageColor(liveData.ramUsage),
              }"
            ></div>
          </div>
        </div>

        <!-- Disco -->
        <div class="tele-card">
          <span class="tele-label">Disco</span>
          <div
            class="tele-value"
            :style="{ color: usageColor(liveData.diskUsage) }"
          >
            {{ liveData.diskUsage?.toFixed(1) ?? "—" }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: (liveData.diskUsage ?? 0) + '%',
                background: usageColor(liveData.diskUsage),
              }"
            ></div>
          </div>
        </div>

        <!-- Rede -->
        <div class="tele-card">
          <span class="tele-label">Download</span>
          <div class="tele-value">
            {{ liveData.downloadUsage?.toFixed(1) ?? "—" }}
            <small>Mbps</small>
          </div>
        </div>
        <div class="tele-card">
          <span class="tele-label">Upload</span>
          <div class="tele-value">
            {{ liveData.uploadUsage?.toFixed(1) ?? "—" }}
            <small>Mbps</small>
          </div>
        </div>

        <!-- Motherboard Temp -->
        <div class="tele-card" v-if="liveData.moboTemperature != null">
          <span class="tele-label">Placa-Mãe</span>
          <div
            class="tele-value"
            :style="{ color: tempColor(liveData.moboTemperature) }"
          >
            {{ liveData.moboTemperature?.toFixed(1) ?? "—" }} °C
          </div>
        </div>
      </div>
      <div v-else class="empty-state" style="padding: 1.5rem 0">
        Sem dados de telemetria disponíveis.
      </div>

      <!-- ═══ SPECS DE HARDWARE ═══ -->
      <h2 class="section-title" style="margin-top: 2rem">Especificações</h2>
      <div class="specs-grid">
        <div class="spec-item">
          <span class="spec-label">CPU</span>
          <span class="spec-value">{{ machine.cpuModel || "—" }}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">GPU</span>
          <span class="spec-value">{{ machine.gpuModel || "—" }}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">RAM</span>
          <span class="spec-value">{{
            machine.totalRamGb ? machine.totalRamGb + " GB" : "—"
          }}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Disco</span>
          <span class="spec-value">{{
            machine.totalDiskGb ? machine.totalDiskGb + " GB" : "—"
          }}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">IP</span>
          <span class="spec-value" style="font-family: monospace">{{
            machine.ipAddress || "—"
          }}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">MAC</span>
          <span class="spec-value" style="font-family: monospace">{{
            machine.macAddress || "—"
          }}</span>
        </div>
        <div class="spec-item" v-if="machine.loggedUser">
          <span class="spec-label">Logado</span>
          <span class="spec-value">{{ machine.loggedUser }}</span>
        </div>
        <div class="spec-item" v-if="machine.lastSeenAt">
          <span class="spec-label">Último report</span>
          <span class="spec-value">{{
            new Date(machine.lastSeenAt).toLocaleString("pt-BR")
          }}</span>
        </div>
      </div>

      <!-- ═══ AGENDAMENTOS ═══ -->
      <h2 class="section-title" style="margin-top: 2rem">Agendamentos</h2>

      <div
        v-if="allocations.length === 0"
        class="empty-state"
        style="padding: 1.5rem 0"
      >
        Nenhum agendamento encontrado.
      </div>

      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Data</th>
              <th>Horário</th>
              <th>Status</th>
              <th style="width: 160px">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in allocations" :key="a.id">
              <td>{{ a.user?.fullName || "—" }}</td>
              <td>{{ fmtDate(a.startTime) }}</td>
              <td>{{ fmtTime(a.startTime) }} – {{ fmtTime(a.endTime) }}</td>
              <td>
                <span :class="['badge', allocStatusBadge(a.status)]">
                  {{ allocStatusLabel(a.status) }}
                </span>
              </td>
              <td>
                <div style="display: flex; gap: 0.3rem; flex-wrap: wrap">
                  <button
                    v-if="a.status === 'pending'"
                    class="btn btn-ghost btn-sm text-accent"
                    @click="handleStatusChange(a, 'approved')"
                  >
                    Aprovar
                  </button>
                  <button
                    v-if="a.status === 'pending'"
                    class="btn btn-danger btn-sm"
                    @click="handleStatusChange(a, 'denied')"
                  >
                    Negar
                  </button>
                  <button
                    v-if="a.status === 'approved'"
                    class="btn btn-ghost btn-sm"
                    @click="handleStatusChange(a, 'cancelled')"
                  >
                    Cancelar
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
}

.tele-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tele-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tele-value {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.1;
  transition: color 0.4s ease;
}
.tele-value small {
  font-size: 0.65em;
  font-weight: 400;
  opacity: 0.7;
}

.progress-fill {
  transition:
    width 0.5s ease,
    background 0.4s ease;
}

.tele-sub {
  font-size: 0.82rem;
  margin-top: 0.15rem;
}

.specs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.5rem 1.5rem;
}

.spec-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-subtle);
}

.spec-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-muted);
}

.spec-value {
  font-size: 0.88rem;
  color: var(--text-secondary);
}
</style>
