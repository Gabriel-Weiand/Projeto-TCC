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

  // Auto-refresh: máquinas+telemetria a cada 10s, alocações a cada 30s
  let tick = 0;
  refreshInterval = setInterval(async () => {
    tick++;
    try {
      await machinesStore.fetchMachines();
      if (tick % 3 === 0) {
        await allocationsStore.fetchAllocations();
      }
    } catch {
      // silently ignore refresh errors
    }
  }, 10_000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
});

const totalMachines = computed(() => machinesStore.machines.length);
const onlineMachines = computed(
  () => machinesStore.machines.filter((m) => m.status !== "offline" && m.status !== "disabled").length,
);
const totalUsers = computed(() => usersStore.users.length);
const pendingAllocations = computed(
  () =>
    allocationsStore.allocations.filter((a) => a.status === "pending").length,
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
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Painel Administrativo</h1>
    </div>

    <div v-if="loading" class="empty-state">Carregando...</div>

    <template v-else>
      <!-- Stat cards -->
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

      <!-- Machine status overview -->
      <h2 class="section-title">Visão Geral das Máquinas</h2>
      <div class="machine-status-grid">
        <div
          v-for="m in machinesStore.machines"
          :key="m.id"
          class="card machine-status-card clickable"
          @click="
            router.push({ name: 'machine-detail', params: { id: m.id } })
          "
        >
          <div class="ms-top">
            <span class="ms-dot" :style="{ background: statusColor(m) }"></span>
            <span class="ms-name">{{ m.name }}</span>
          </div>
          <span class="ms-status text-secondary" style="font-size: 0.82rem">{{
            statusLabel(m.status)
          }}</span>

          <template v-if="m.latestTelemetry">
            <div class="ms-telemetry">
              <div class="ms-tele-row">
                <span>CPU</span>
                <div class="progress-bar" style="flex: 1">
                  <div
                    class="progress-fill"
                    :style="{ width: m.latestTelemetry.cpuUsage + '%' }"
                  ></div>
                </div>
                <span>{{ m.latestTelemetry.cpuUsage.toFixed(0) }}%</span>
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
                    :style="{ width: m.latestTelemetry.gpuUsage + '%' }"
                  ></div>
                </div>
                <span>{{ m.latestTelemetry.gpuUsage.toFixed(0) }}%</span>
              </div>
            </div>
          </template>

          <div
            v-if="primarySessionLabel(m)"
            class="ms-user text-muted"
            style="font-size: 0.78rem; margin-top: auto"
          >
            Logado: {{ primarySessionLabel(m) }}
          </div>
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
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.machine-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
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
</style>
