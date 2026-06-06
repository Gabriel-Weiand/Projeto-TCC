<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useMachinesStore } from "@/stores/machines";
import { useAllocationsStore } from "@/stores/allocations";
import { useUsersStore } from "@/stores/users";
import type { Machine, RealtimeTelemetry } from "@/types";
import { isNowBeforeUtc } from "@/utils/datetime";

const router = useRouter();

const machinesStore = useMachinesStore();
const allocationsStore = useAllocationsStore();
const usersStore = useUsersStore();

const loading = ref(true);

/** Um GET /machines traz latestTelemetry de todas (buffer + fallback bucket ocioso). */
const REFRESH_MS = 60_000;
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  try {
    await Promise.all([
      machinesStore.fetchMachines(),
      allocationsStore.fetchAllocations(),
      usersStore.fetchUsers(),
    ]);
  } finally {
    loading.value = false;
  }

  let tick = 0;
  refreshInterval = setInterval(async () => {
    tick++;
    try {
      await machinesStore.fetchMachines();
      if (tick % 2 === 0) {
        await allocationsStore.fetchAllocations();
      }
    } catch {
      /* ignore */
    }
  }, REFRESH_MS);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
});

const totalMachines = computed(() => machinesStore.machines.length);
const onlineMachines = computed(
  () =>
    machinesStore.machines.filter(
      (m) => m.status !== "offline" && m.status !== "disabled",
    ).length,
);
const totalUsers = computed(() => usersStore.users.length);
const pendingAllocations = computed(
  () => allocationsStore.allocations.filter((a) => a.status === "pending").length,
);
const scheduledAllocations = computed(
  () =>
    allocationsStore.allocations.filter(
      (a) => a.status === "approved" && isNowBeforeUtc(a.startTime),
    ).length,
);
const activeAllocations = computed(
  () =>
    allocationsStore.allocations.filter(
      (a) => a.status === "approved" && !isNowBeforeUtc(a.startTime),
    ).length,
);

function isMachineActive(m: Machine): boolean {
  const now = Date.now();
  if (m.lastSeenAt) {
    const seen = new Date(m.lastSeenAt).getTime();
    if (Number.isFinite(seen) && now - seen <= LIVE_WINDOW_MS) return true;
  }
  if (m.latestTelemetry?.timestamp) {
    const ts = new Date(m.latestTelemetry.timestamp).getTime();
    if (Number.isFinite(ts) && now - ts <= LIVE_WINDOW_MS) return true;
  }
  return false;
}

const activeMachines = computed(() =>
  machinesStore.machines.filter((m) => isMachineActive(m)),
);

const inactiveMachines = computed(() =>
  machinesStore.machines.filter((m) => !isMachineActive(m)),
);

function statusColor(m: Machine) {
  const map: Record<string, string> = {
    available: "var(--success)",
    occupied: "var(--warning)",
    maintenance: "var(--info)",
    offline: "var(--text-muted)",
  };
  return map[m.status] || "var(--text-muted)";
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

function telePctWidth(val: number | null | undefined): number {
  return val != null ? val : 0;
}

function telePctLabel(val: number | null | undefined): string {
  return val != null ? `${val.toFixed(0)}%` : "—";
}

function ramUsagePct(t: RealtimeTelemetry): number {
  const total = t.ramTotalGb;
  const used = t.ramUsedGb;
  if (total == null || used == null || total <= 0) return 0;
  return (used / total) * 100;
}

function primarySessionLabel(m: Machine): string | null {
  const users = m.latestTelemetry?.activeUsers ?? m.activeUsers;
  if (!users?.length) return null;
  const first = users[0] as { username?: string; name?: string } | string;
  if (typeof first === "string") return first;
  return first.username ?? first.name ?? null;
}

function goToMachine(m: Machine) {
  router.push({
    name: "machine-detail",
    params: { id: m.id },
    query: { from: "admin" },
  });
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Painel Administrativo</h1>
    </div>

    <div v-if="loading" class="empty-state">Carregando...</div>

    <template v-else>
      <div class="stats-row">
        <div class="stat-card">
          <span class="stat-label">Máquinas</span>
          <span class="stat-value">{{ totalMachines }}</span>
          <span class="stat-sub">{{ onlineMachines }} Online</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Usuários</span>
          <span class="stat-value">{{ totalUsers }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Ativas</span>
          <span class="stat-value">{{ activeAllocations }}</span>
          <span class="stat-sub">Reservas Aprovadas</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Agendadas</span>
          <span class="stat-value">{{ scheduledAllocations }}</span>
          <span class="stat-sub">Próximas Reservas</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Pendentes</span>
          <span class="stat-value">{{ pendingAllocations }}</span>
          <span class="stat-sub">Aguardando Aprovação</span>
        </div>
      </div>

      <h2 class="section-title">
        Máquinas ativas
        <span class="section-count text-muted">{{ activeMachines.length }}</span>
      </h2>
      <p class="section-hint text-secondary">
        Heartbeat ou telemetria nas últimas 24 h — atualização via GET /machines a cada
        {{ REFRESH_MS / 1000 }} s.
      </p>
      <div v-if="activeMachines.length === 0" class="empty-state section-empty">
        Nenhuma máquina com sinal recente.
      </div>
      <div v-else class="machine-status-grid">
        <div
          v-for="m in activeMachines"
          :key="m.id"
          class="card machine-status-card clickable"
          @click="goToMachine(m)"
        >
          <div class="ms-top">
            <span class="ms-dot" :style="{ background: statusColor(m) }"></span>
            <span class="ms-name">{{ m.name }}</span>
          </div>
          <span class="ms-status text-secondary">{{ statusLabel(m.status) }}</span>

          <template v-if="m.latestTelemetry">
            <div class="ms-telemetry">
              <div class="ms-tele-row">
                <span>CPU</span>
                <div class="progress-bar" style="flex: 1">
                  <div
                    class="progress-fill"
                    :style="{ width: telePctWidth(m.latestTelemetry.cpuUsage) + '%' }"
                  ></div>
                </div>
                <span>{{ telePctLabel(m.latestTelemetry.cpuUsage) }}</span>
              </div>
              <div class="ms-tele-row">
                <span>RAM</span>
                <div class="progress-bar" style="flex: 1">
                  <div
                    class="progress-fill"
                    :style="{ width: ramUsagePct(m.latestTelemetry) + '%' }"
                  ></div>
                </div>
                <span>{{ ramUsagePct(m.latestTelemetry).toFixed(0) }}%</span>
              </div>
              <div class="ms-tele-row">
                <span>GPU</span>
                <div class="progress-bar" style="flex: 1">
                  <div
                    class="progress-fill"
                    :style="{ width: telePctWidth(m.latestTelemetry.gpuUsage) + '%' }"
                  ></div>
                </div>
                <span>{{ telePctLabel(m.latestTelemetry.gpuUsage) }}</span>
              </div>
            </div>
          </template>

          <div v-if="primarySessionLabel(m)" class="ms-user text-muted">
            Logado: {{ primarySessionLabel(m) }}
          </div>
        </div>
      </div>

      <h2 class="section-title section-spaced">
        Máquinas inativas
        <span class="section-count text-muted">{{ inactiveMachines.length }}</span>
      </h2>
      <p class="section-hint text-secondary">
        Sem heartbeat nem telemetria nas últimas 24 h.
      </p>
      <div v-if="inactiveMachines.length === 0" class="empty-state section-empty">
        Todas as máquinas têm sinal recente.
      </div>
      <div v-else class="machine-status-grid">
        <div
          v-for="m in inactiveMachines"
          :key="m.id"
          class="card machine-status-card clickable machine-status-card--inactive"
          @click="goToMachine(m)"
        >
          <div class="ms-top">
            <span class="ms-dot" :style="{ background: statusColor(m) }"></span>
            <span class="ms-name">{{ m.name }}</span>
          </div>
          <span class="ms-status text-secondary">{{ statusLabel(m.status) }}</span>
          <span class="ms-offline-hint text-muted">Sem telemetria recente</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats-row .stat-label {
  text-transform: none;
  letter-spacing: normal;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

@media (max-width: 1100px) {
  .stats-row {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}

.section-title {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.35rem;
}

.section-spaced {
  margin-top: 2rem;
}

.section-count {
  font-size: 0.85rem;
  font-weight: 500;
}

.section-hint {
  font-size: 0.82rem;
  margin: 0 0 1rem;
}

.section-empty {
  padding: 1.25rem 0;
  margin-bottom: 1rem;
}

.machine-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.clickable {
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.clickable:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.machine-status-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 1rem 1.25rem;
  min-height: 7.5rem;
}

.machine-status-card--inactive {
  opacity: 0.82;
}

.ms-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.ms-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ms-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.ms-telemetry {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.5rem;
}
.ms-tele-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.ms-tele-row span:first-child {
  width: 28px;
  font-weight: 600;
  color: var(--text-muted);
}
.ms-tele-row span:last-child {
  width: 36px;
  text-align: right;
}

.ms-user {
  font-size: 0.78rem;
  margin-top: auto;
}

.ms-offline-hint {
  font-size: 0.78rem;
  margin-top: auto;
}
</style>
