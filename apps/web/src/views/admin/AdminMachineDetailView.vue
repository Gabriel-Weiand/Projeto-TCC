<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMachinesStore } from "@/stores/machines";
import { useTelemetryPlayback } from "@/composables/useTelemetryPlayback";
import MachineTelemetryPanel from "@/components/MachineTelemetryPanel.vue";
import MachineLiveSections from "@/components/MachineLiveSections.vue";
import CalendarGanttScroll from "@/components/CalendarGanttScroll.vue";
import type { Machine, Allocation } from "@/types";

const route = useRoute();
const router = useRouter();
const machinesStore = useMachinesStore();

const machineId = computed(() => Number(route.params.id));
const machine = ref<Machine | null>(null);
const allocations = ref<Allocation[]>([]);
const loading = ref(true);
const tokenModal = ref(false);
const tokenValue = ref("");
const regeneratingToken = ref(false);
const debugRefreshing = ref(false);
const debugStreamPreview = ref<unknown>(null);

const {
  current: telemetry,
  start: startPlayback,
  stop: stopPlayback,
} = useTelemetryPlayback(machineId);

let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  try {
    const [m, allocs] = await Promise.all([
      machinesStore.fetchMachine(machineId.value),
      machinesStore.fetchMachineAllocations(machineId.value, { limit: 200 }),
    ]);
    machine.value = m;
    allocations.value = allocs.data || [];
    startPlayback();

    refreshInterval = setInterval(async () => {
      try {
        const [m, allocs] = await Promise.all([
          machinesStore.fetchMachine(machineId.value),
          machinesStore.fetchMachineAllocations(machineId.value, { limit: 200 }),
        ]);
        machine.value = m;
        allocations.value = allocs.data || [];
      } catch {
        /* ignore */
      }
    }, 30_000);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  stopPlayback();
  if (refreshInterval) clearInterval(refreshInterval);
});

const liveData = computed(
  () => telemetry.value || machine.value?.latestTelemetry || null,
);

const ganttMachines = computed(() => (machine.value ? [machine.value] : []));

type ActiveUserRow = {
  key: string;
  username: string;
  terminal: string;
  host: string;
  isSsh: boolean;
  source: string;
};

const activeUserRows = computed((): ActiveUserRow[] => {
  const rows: ActiveUserRow[] = [];
  const seen = new Set<string>();

  const tele = liveData.value?.activeUsers;
  if (Array.isArray(tele)) {
    for (const raw of tele) {
      const u = raw as Record<string, unknown>;
      const username = String(u.username ?? "—");
      const terminal = String(u.terminal ?? "—");
      const host = String(u.host ?? "—");
      const key = `${username}|${terminal}|${host}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        username,
        terminal,
        host,
        isSsh: Boolean(u.isSsh),
        source: "telemetria",
      });
    }
  }

  const hb = machine.value?.currentSessions;
  if (Array.isArray(hb)) {
    for (const raw of hb) {
      const username =
        typeof raw === "string"
          ? raw
          : String((raw as { username?: string }).username ?? raw);
      if (rows.some((r) => r.username === username)) continue;
      rows.push({
        key: `hb-${username}`,
        username,
        terminal: "—",
        host: "(heartbeat)",
        isSsh: false,
        source: "heartbeat",
      });
    }
  }
  return rows;
});

const apiDebugJson = computed(() => ({
  systemUsername: machine.value?.systemUsername ?? null,
  currentSessions: machine.value?.currentSessions ?? null,
  activeUsersTelemetry: liveData.value?.activeUsers ?? null,
  telemetryPreset: machine.value?.telemetryPreset ?? null,
  telemetrySet: machine.value?.customAgentConfig?.telemetrySet ?? null,
  diskIO: {
    readMbps: liveData.value?.diskReadMbps ?? null,
    writeMbps: liveData.value?.diskWriteMbps ?? null,
  },
  streamPreview: debugStreamPreview.value,
}));

async function refreshFromApi() {
  debugRefreshing.value = true;
  try {
    const [m, stream] = await Promise.all([
      machinesStore.fetchMachine(machineId.value),
      machinesStore.fetchTelemetryStream(machineId.value, 5),
    ]);
    machine.value = m;
    debugStreamPreview.value = stream;
  } finally {
    debugRefreshing.value = false;
  }
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

function onTelemetrySaved(m: Machine) {
  machine.value = m;
}

async function handleRegenerateToken() {
  if (!machine.value) return;
  if (
    !confirm(
      `Regenerar token de "${machine.value.name}"? O token atual será invalidado.`,
    )
  ) {
    return;
  }
  regeneratingToken.value = true;
  try {
    const result = await machinesStore.regenerateToken(machine.value.id);
    tokenValue.value = result.token;
    tokenModal.value = true;
  } catch {
    alert("Erro ao regenerar token.");
  } finally {
    regeneratingToken.value = false;
  }
}

function copyToken() {
  if (tokenValue.value) {
    navigator.clipboard.writeText(tokenValue.value).catch(() => {});
  }
}
</script>

<template>
  <div class="fade-in admin-machine">
    <button class="btn btn-ghost btn-sm" style="margin-bottom: 1rem" @click="router.back()">
      ← Voltar
    </button>

    <div v-if="loading" class="empty-state">Carregando...</div>

    <template v-else-if="machine">
      <div class="detail-header">
        <div>
          <h1 class="page-title" style="margin-bottom: 0.25rem">
            {{ machine.name }}
          </h1>
          <p class="text-secondary" style="font-size: 0.9rem">
            {{ machine.description || "Sem descrição" }}
          </p>
        </div>
        <div class="header-actions">
          <span
            :class="['badge', statusBadge(machine.status)]"
            style="font-size: 0.85rem; padding: 0.35rem 0.9rem"
          >
            {{ statusLabel(machine.status) }}
          </span>
          <MachineTelemetryPanel
            trigger="button"
            :machine="machine"
            @saved="onTelemetrySaved"
          />
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="regeneratingToken"
            @click="handleRegenerateToken"
          >
            {{ regeneratingToken ? "Gerando…" : "Regenerar token" }}
          </button>
        </div>
      </div>

      <div class="specs-grid">
        <div v-if="machine.cpuModel" class="stat-card">
          <span class="stat-label">CPU</span>
          <span class="stat-value" style="font-size: 1rem">{{ machine.cpuModel }}</span>
        </div>
        <div v-if="machine.gpuModel || machine.totalVramGb" class="stat-card">
          <span class="stat-label">GPU</span>
          <span class="stat-value" style="font-size: 1rem">{{ machine.gpuModel || "—" }}</span>
          <span v-if="machine.totalVramGb" class="stat-sub text-muted">
            {{ machine.totalVramGb }} GB VRAM
          </span>
        </div>
        <div v-if="machine.totalRamGb" class="stat-card">
          <span class="stat-label">RAM</span>
          <span class="stat-value">{{ machine.totalRamGb }} GB</span>
        </div>
        <div v-if="machine.totalDiskGb" class="stat-card">
          <span class="stat-label">Disco Total</span>
          <span class="stat-value">{{ machine.totalDiskGb }} GB</span>
        </div>
        <div v-if="machine.ipAddress" class="stat-card">
          <span class="stat-label">IP</span>
          <span class="stat-value" style="font-size: 1rem">{{ machine.ipAddress }}</span>
        </div>
        <div v-if="machine.hostFingerprint" class="stat-card stat-card--wide">
          <span class="stat-label">Fingerprint SSH (host)</span>
          <code class="stat-value fingerprint">{{ machine.hostFingerprint }}</code>
        </div>
      </div>

      <MachineLiveSections :machine="machine" :live-data="liveData" />

      <h2 class="section-title section-spaced">Usuários na máquina</h2>
      <p class="section-hint">
        Sessões reportadas pelo agente (<code>activeUsers</code> na telemetria e
        <code>connectedUsers</code> no heartbeat a cada 30s).
      </p>

      <div v-if="activeUserRows.length" class="table-wrap users-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Terminal</th>
              <th>Origem</th>
              <th>SSH</th>
              <th>Fonte</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in activeUserRows" :key="row.key">
              <td>{{ row.username }}</td>
              <td><code>{{ row.terminal }}</code></td>
              <td>{{ row.host }}</td>
              <td>
                <span v-if="row.isSsh" class="badge badge-info">SSH</span>
                <span v-else class="text-muted">local</span>
              </td>
              <td class="text-muted">{{ row.source }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state" style="padding: 1rem 0">
        Nenhuma sessão ativa na API.
      </div>

      <details class="api-debug">
        <summary>Debug — dados brutos da API</summary>
        <div class="api-debug-actions">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="debugRefreshing"
            @click="refreshFromApi"
          >
            {{ debugRefreshing ? "Consultando…" : "Atualizar da API" }}
          </button>
        </div>
        <pre class="api-debug-pre">{{ JSON.stringify(apiDebugJson, null, 2) }}</pre>
      </details>

      <!-- Gantt -->
      <section class="row-block gantt-block">
        <h2 class="row-title">Agenda</h2>
        <CalendarGanttScroll
          compact
          :machines="ganttMachines"
          :allocations="allocations"
          :loading="false"
        />
      </section>
    </template>

    <!-- Modal: token -->
    <Teleport to="body">
      <div v-if="tokenModal && tokenValue" class="modal-overlay" @click.self="tokenModal = false">
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">Token do agente</h2>
            <button type="button" class="btn-close" @click="tokenModal = false">✕</button>
          </div>
          <div class="modal-body">
            <p class="text-secondary" style="font-size: 0.88rem">
              Use em <code>MACHINE_TOKEN</code> no <code>.env</code> do agente.
            </p>
            <div class="token-box">{{ tokenValue }}</div>
            <button type="button" class="btn btn-primary btn-sm" @click="copyToken">
              Copiar token
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-machine {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.header-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.specs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.row-block {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 0.75rem 0.85rem;
}

.row-title {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 0 0 0.55rem;
}

.row-empty,
.row-empty-inline {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.row-empty {
  padding: 0.5rem 0;
}

.telemetry-row {
  display: flex;
  gap: 0.55rem;
  overflow-x: auto;
  padding-bottom: 0.15rem;
}

.tele-card {
  flex: 1;
  min-width: 110px;
  max-width: 160px;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.tele-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
}

.tele-value {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.1;
}

.tele-sub {
  font-size: 0.75rem;
}

.tele-io {
  font-size: 0.78rem;
  line-height: 1.35;
  color: var(--text-secondary);
}

.disk-table.compact {
  border: none;
  background: transparent;
  margin: 0;
}

.disk-table.compact .disk-header,
.disk-table.compact .disk-row-detail {
  padding: 0.35rem 0;
}

.disk-table.compact .disk-header {
  background: transparent;
  font-size: 0.65rem;
}

.disk-table.compact .disk-row-detail {
  font-size: 0.78rem;
}

.disk-table {
  overflow: hidden;
}

.disk-header {
  display: flex;
  border-bottom: 1px solid var(--border-subtle);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
}

.disk-row-detail {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
}

.disk-row-detail:last-child {
  border-bottom: none;
}

.disk-col {
  flex-shrink: 0;
}

.device-col {
  width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-col code {
  font-size: 0.7rem;
}

.mount-col {
  width: 90px;
  font-weight: 500;
}

.size-col,
.free-col {
  width: 70px;
  text-align: right;
}

.bar-col {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 80px;
}

.disk-bar-track {
  flex: 1;
  height: 5px;
  background: var(--bg-input);
  border-radius: 3px;
  overflow: hidden;
}

.disk-bar-fill {
  height: 100%;
  border-radius: 3px;
}

.disk-pct-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  min-width: 28px;
  text-align: right;
}

.users-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.user-box {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.user-box-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
}

.user-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.user-tag {
  font-size: 0.78rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(124, 108, 240, 0.15);
  color: var(--accent);
  border: 1px solid rgba(124, 108, 240, 0.25);
}

.user-tag.muted {
  background: var(--bg-card-solid);
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.section-spaced {
  margin-top: 2rem;
}

.section-hint {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin: -0.5rem 0 1rem;
  line-height: 1.45;
}

.users-table-wrap {
  margin-bottom: 1rem;
}

.api-debug {
  margin-top: 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 0.65rem 0.85rem;
  background: var(--bg-card-solid);
}

.api-debug summary {
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-muted);
}

.api-debug-actions {
  margin: 0.75rem 0 0.5rem;
}

.api-debug-pre {
  font-size: 0.72rem;
  max-height: 280px;
  overflow: auto;
  background: var(--bg-input);
  padding: 0.75rem;
  border-radius: 8px;
  color: var(--text-secondary);
}

.gantt-block {
  padding-bottom: 0.5rem;
}

.gantt-block :deep(.gantt-wrap--compact .toolbar) {
  padding: 0.35rem 0.5rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.modal-glass {
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated);
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-title {
  font-size: 1.05rem;
  font-weight: 600;
}

.modal-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.detail-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  font-size: 0.88rem;
}

.detail-list dt {
  color: var(--text-muted);
  font-weight: 600;
}

.detail-list dd {
  margin: 0;
  color: var(--text-secondary);
}

.fingerprint {
  font-size: 0.72rem;
  word-break: break-all;
}

.token-box {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  word-break: break-all;
  font-family: monospace;
  font-size: 0.78rem;
  color: var(--accent);
}
</style>
