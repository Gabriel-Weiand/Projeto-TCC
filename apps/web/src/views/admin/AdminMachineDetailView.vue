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

    startPlayback();

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

const liveData = computed(() => {
  return telemetry.value || machine.value?.latestTelemetry || null;
});

// Calcula a porcentagem on-the-fly (lembrando que os valores vêm multiplicados por 10)
function calcUsagePct(used: number | null | undefined, total: number | null | undefined): string {
  if (used == null || total == null || total === 0) return "—";
  return ((used / total) * 100).toFixed(1);
}

// Determina a cor com base no cálculo da porcentagem
function calcUsageColor(used: number | null | undefined, total: number | null | undefined): string {
  if (used == null || total == null || total === 0) return "var(--text-muted)";
  const pct = (used / total) * 100;
  if (pct < 50) return "var(--success)";
  if (pct < 80) return "var(--warning)";
  return "var(--danger)";
}

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

function fmtGb(val: number | null | undefined): string {
  if (val == null) return "--";
  return val.toFixed(1) + " GB";
}

function diskUsedPct(total: number | null, free: number | null): number {
  if (!total || total <= 0 || free == null) return 0;
  return Math.round(((total - free) / total) * 100);
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

function fmtPct(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(1);
}

function fmtTemp(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(1);
}

function fmtRamGb(val: number | null | undefined): string {
  if (val == null) return "--";
  return val.toFixed(1) + " GB";
}

// Computada para exibir usuários logados de forma reativa
const activeUsersList = computed(() => {
  const users = liveData.value?.activeUsers || machine.value?.activeUsers;
  return users && users.length > 0 ? users.map((u: any) => u.username).join(', ') : "—";
});

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
        <div class="tele-card">
          <span class="tele-label">CPU</span>
          <div class="tele-value" :style="{ color: usageColor(liveData.cpuUsage) }">
            {{ fmtPct(liveData.cpuUsage) }}%
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: ((liveData.cpuUsage ?? 0)) + '%', background: usageColor(liveData.cpuUsage) }"></div>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="tele-sub" :style="{ color: tempColor(liveData.cpuTemp) }">
              {{ fmtTemp(liveData.cpuTemp) }} °C
            </span>
            <span class="tele-sub" v-if="liveData.cpuFreqMhz" style="color: var(--text-muted)">
              {{ liveData.cpuFreqMhz }} MHz
            </span>
          </div>
        </div>

        <div class="tele-card">
          <span class="tele-label">GPU</span>
          <div class="tele-value" :style="{ color: usageColor(liveData.gpuUsage) }">
            {{ fmtPct(liveData.gpuUsage) }}%
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: ((liveData.gpuUsage ?? 0)) + '%', background: usageColor(liveData.gpuUsage) }"></div>
          </div>
          <span class="tele-sub" :style="{ color: tempColor(liveData.gpuTemp) }">
            {{ fmtTemp(liveData.gpuTemp) }} °C
          </span>
        </div>

        <div class="tele-card" v-if="liveData.ramTotalGb != null">
          <span class="tele-label">RAM</span>
          <div class="tele-value" :style="{ color: calcUsageColor(liveData.ramUsedGb, liveData.ramTotalGb) }">
            {{ calcUsagePct(liveData.ramUsedGb, liveData.ramTotalGb) }}%
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: calcUsagePct(liveData.ramUsedGb, liveData.ramTotalGb) + '%', background: calcUsageColor(liveData.ramUsedGb, liveData.ramTotalGb) }"></div>
          </div>
          <span class="tele-sub">
            {{ fmtRamGb(liveData.ramUsedGb) }} / {{ fmtRamGb(liveData.ramTotalGb) }}
          </span>
        </div>

        <div class="tele-card" v-if="liveData.swapTotalGb != null">
          <span class="tele-label">Swap</span>
          <div class="tele-value" :style="{ color: calcUsageColor(liveData.swapUsedGb, liveData.swapTotalGb) }">
            {{ calcUsagePct(liveData.swapUsedGb, liveData.swapTotalGb) }}%
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: calcUsagePct(liveData.swapUsedGb, liveData.swapTotalGb) + '%', background: calcUsageColor(liveData.swapUsedGb, liveData.swapTotalGb) }"></div>
          </div>
          <span class="tele-sub">
            {{ fmtRamGb(liveData.swapUsedGb) }} / {{ fmtRamGb(liveData.swapTotalGb) }}
          </span>
        </div>

        <div class="tele-card">
          <span class="tele-label">Disco (I/O)</span>
          <div class="tele-value" style="font-size: 1.1rem; line-height: 1.4; display: flex; flex-direction: column; justify-content: center;">
            <span><span style="color: var(--success)">↓</span> {{ liveData.diskReadMbps ?? "—" }} <small>Mbps</small></span>
            <span><span style="color: var(--info)">↑</span> {{ liveData.diskWriteMbps ?? "—" }} <small>Mbps</small></span>
          </div>
        </div>

        <div class="tele-card">
          <span class="tele-label">Rede</span>
          <div class="tele-value" style="font-size: 1.1rem; line-height: 1.4; display: flex; flex-direction: column; justify-content: center;">
            <span><span style="color: var(--success)">↓</span> {{ liveData.downloadMbps ?? "—" }} <small>Mbps</small></span>
            <span><span style="color: var(--info)">↑</span> {{ liveData.uploadMbps ?? "—" }} <small>Mbps</small></span>
          </div>
        </div>

        <div class="tele-card" v-if="liveData.moboTemperature != null">
          <span class="tele-label">Placa-Mãe</span>
          <div class="tele-value" :style="{ color: tempColor(liveData.moboTemperature) }">
            {{ fmtTemp(liveData.moboTemperature) }} °C
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
        
        <div class="spec-item" v-if="machine.activeUsers && machine.activeUsers.length > 0">
          <span class="spec-label">Logado(s)</span>
          <span class="spec-value">{{ machine.activeUsers.map(u => u.username).join(', ') }}</span>
        </div>

        <div class="spec-item" v-if="machine.lastSeenAt">
          <span class="spec-label">Último report</span>
          <span class="spec-value">{{
            new Date(machine.lastSeenAt).toLocaleString("pt-BR")
          }}</span>
        </div>
      </div>

      <!-- ═══ PARTIÇÕES DE DISCO ═══ -->
      <template v-if="machine.disks && machine.disks.length > 0">
        <h2 class="section-title" style="margin-top: 2rem">Partições de Disco</h2>
        <div class="disk-table">
          <div class="disk-header">
            <span class="disk-col device-col">Dispositivo</span>
            <span class="disk-col mount-col">Montagem</span>
            <span class="disk-col fs-col">FS</span>
            <span class="disk-col size-col">Total</span>
            <span class="disk-col free-col">Livre</span>
            <span class="disk-col bar-col">Uso</span>
          </div>
          <div v-for="d in machine.disks" :key="d.id" class="disk-row-detail">
            <span class="disk-col device-col">
              <code>{{ d.device }}</code>
            </span>
            <span class="disk-col mount-col">{{ d.mountpoint }}</span>
            <span class="disk-col fs-col">
              <span class="badge badge-info" style="font-size: 0.65rem">{{ d.fstype || "--" }}</span>
            </span>
            <span class="disk-col size-col">{{ fmtGb(d.totalGb) }}</span>
            <span class="disk-col free-col" :class="{
              'text-success': (d.freeGb ?? 0) > 50,
              'text-warning': (d.freeGb ?? 0) > 10 && (d.freeGb ?? 0) <= 50,
              'text-danger': (d.freeGb ?? 0) <= 10 && d.freeGb != null,
            }">
              {{ fmtGb(d.freeGb) }}
            </span>
            <span class="disk-col bar-col">
              <div class="disk-bar-track">
                <div
                  class="disk-bar-fill"
                  :style="{
                    width: diskUsedPct(d.totalGb, d.freeGb) + '%',
                    background:
                      diskUsedPct(d.totalGb, d.freeGb) > 90
                        ? 'var(--danger)'
                        : diskUsedPct(d.totalGb, d.freeGb) > 70
                          ? 'var(--warning)'
                          : 'var(--success)',
                  }"
                ></div>
              </div>
              <span class="disk-pct-label">{{ diskUsedPct(d.totalGb, d.freeGb) }}%</span>
            </span>
          </div>
        </div>
      </template>

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
  /* Força exatamente 6 colunas na primeira linha com tamanhos perfeitamente iguais */
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.75rem;
}

/* Proteção para telas menores (notebooks/tablets) não esmagarem os cards */
@media (max-width: 1200px) {
  .telemetry-grid {
    grid-template-columns: repeat(3, 1fr);
  }
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

/* ---- Disk Partition Table ---- */
.disk-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 1rem;
  background: var(--bg-card);
}
.disk-header {
  display: flex;
  padding: 0.5rem 0.75rem;
  background: var(--bg-card-solid);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.disk-row-detail {
  display: flex;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  align-items: center;
  font-size: 0.82rem;
}
.disk-row-detail:last-child {
  border-bottom: none;
}
.disk-col {
  flex-shrink: 0;
}
.device-col {
  width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-col code {
  font-size: 0.72rem;
  color: var(--text-secondary);
}
.mount-col {
  width: 120px;
  font-weight: 500;
  color: var(--text-primary);
}
.fs-col {
  width: 70px;
}
.size-col {
  width: 80px;
  text-align: right;
  color: var(--text-secondary);
}
.free-col {
  width: 80px;
  text-align: right;
}
.bar-col {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 100px;
  padding-left: 0.75rem;
}
.disk-bar-track {
  flex: 1;
  height: 6px;
  background: var(--bg-input);
  border-radius: 3px;
  overflow: hidden;
}
.disk-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}
.disk-pct-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  min-width: 32px;
  text-align: right;
}
</style>