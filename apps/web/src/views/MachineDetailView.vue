<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import { useAllocationsStore } from "@/stores/allocations";
import { useAuthStore } from "@/stores/auth";
import { useTelemetryPlayback } from "@/composables/useTelemetryPlayback";
import MachineTelemetryPanel from "@/components/MachineTelemetryPanel.vue";
import MachineLiveSections from "@/components/MachineLiveSections.vue";
import CalendarGanttScroll from "@/components/CalendarGanttScroll.vue";
import type { Machine, Allocation } from "@/types";
import { useRouter } from "vue-router";
import { useLabConfigStore } from "@/stores/labConfig";
import { wallClockToUtcIso } from "@/utils/datetime";
import { ALLOCATION_REASON_MAX_LENGTH } from "@/utils/allocationLabels";

const props = defineProps<{ id: string | number }>();
const machinesStore = useMachinesStore();
const allocationsStore = useAllocationsStore();
const auth = useAuthStore();
const lab = useLabConfigStore();
const router = useRouter();

const machineId = computed(() => Number(props.id));
const machine = ref<Machine | null>(null);
const scheduleAllocations = ref<Allocation[]>([]);
const loading = ref(true);
const showForm = ref(false);
const debugRefreshing = ref(false);
const debugStreamPreview = ref<unknown>(null);

const isAdmin = computed(() => auth.user?.role === "admin");

const {
  current: telemetry,
  start: startPlayback,
  stop: stopPlayback,
} = useTelemetryPlayback(machineId);

let allocRefresh: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  try {
    const [m, sched] = await Promise.all([
      machinesStore.fetchMachine(machineId.value),
      machinesStore.fetchMachineAllocations(machineId.value, { limit: 200 }),
    ]);
    machine.value = m;
    scheduleAllocations.value = sched.data || [];
    startPlayback();

    allocRefresh = setInterval(async () => {
      try {
        const [m, sched] = await Promise.all([
          machinesStore.fetchMachine(machineId.value),
          machinesStore.fetchMachineAllocations(machineId.value, { limit: 200 }),
        ]);
        machine.value = m;
        scheduleAllocations.value = sched.data || [];
      } catch {
        /* ignore */
      }
    }, 30_000);
  } catch {
    router.push({ name: "machines" });
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  stopPlayback();
  if (allocRefresh) clearInterval(allocRefresh);
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

/* ---- Reserva ---- */
const form = ref({ date: "", startTime: "", endTime: "", reason: "" });
const formSaving = ref(false);
const formError = ref("");

function openForm() {
  form.value = { date: "", startTime: "", endTime: "", reason: "" };
  formError.value = "";
  showForm.value = true;
}

async function handleCreate() {
  if (!machine.value) return;
  formError.value = "";
  if (!form.value.date || !form.value.startTime || !form.value.endTime) {
    formError.value = "Preencha todos os campos obrigatórios.";
    return;
  }
  if (form.value.startTime >= form.value.endTime) {
    formError.value = "Horário de início deve ser antes do fim.";
    return;
  }
  let startTime: string;
  let endTime: string;
  try {
    startTime = wallClockToUtcIso(
      form.value.date,
      form.value.startTime,
      lab.timezone,
    );
    endTime = wallClockToUtcIso(form.value.date, form.value.endTime, lab.timezone);
  } catch {
    formError.value = "Data ou horário inválido.";
    return;
  }

  formSaving.value = true;
  try {
    await allocationsStore.createAllocation({
      machineId: machine.value.id,
      startTime,
      endTime,
      reason:
        form.value.reason.trim().slice(0, ALLOCATION_REASON_MAX_LENGTH) ||
        undefined,
    });
    showForm.value = false;
    const sched = await machinesStore.fetchMachineAllocations(machineId.value, {
      limit: 200,
    });
    scheduleAllocations.value = sched.data || [];
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 409) formError.value = "Conflito de horário com outra reserva.";
    else if (status === 422) formError.value = "Dados inválidos. Verifique os campos.";
    else formError.value = "Erro ao criar reserva.";
  } finally {
    formSaving.value = false;
  }
}

function onTelemetrySaved(m: Machine) {
  machine.value = m;
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

</script>

<template>
  <div class="fade-in">
    <button
      class="btn btn-ghost btn-sm"
      style="margin-bottom: 1rem"
      @click="router.push({ name: 'machines' })"
    >
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
            v-if="isAdmin"
            trigger="button"
            :machine="machine"
            @saved="onTelemetrySaved"
          />
          <button
            v-if="machine.status !== 'maintenance'"
            class="btn btn-primary btn-sm"
            @click="openForm"
          >
            + Reservar
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
      </div>

      <MachineLiveSections :machine="machine" :live-data="liveData" />

      <template v-if="isAdmin">
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
          Nenhuma sessão ativa na API. Se você está em SSH, confira o preset (activeUsers) e se o
          agente tem permissão para listar sessões.
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
      </template>

      <!-- Gantt -->
      <section class="row-block gantt-block">
        <h2 class="row-title">Agenda</h2>
        <CalendarGanttScroll
          compact
          :machines="ganttMachines"
          :allocations="scheduleAllocations"
          :current-user-id="auth.user?.id ?? null"
          :loading="false"
        />
      </section>
    </template>

    <!-- Modal: reserva -->
    <Teleport to="body">
      <div v-if="showForm && machine" class="modal-overlay" @click.self="showForm = false">
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">Reservar {{ machine.name }}</h2>
            <button type="button" class="btn-close" @click="showForm = false">✕</button>
          </div>
          <form class="modal-body" @submit.prevent="handleCreate">
            <div class="field">
              <label class="field-label">Data</label>
              <input v-model="form.date" type="date" />
            </div>
            <div class="field-row">
              <div class="field">
                <label class="field-label">Início</label>
                <input v-model="form.startTime" type="time" />
              </div>
              <div class="field">
                <label class="field-label">Fim</label>
                <input v-model="form.endTime" type="time" />
              </div>
            </div>
            <div class="field">
              <label class="field-label"
                >Motivo
                <span class="text-muted"
                  >(opcional, máx. {{ ALLOCATION_REASON_MAX_LENGTH }})</span
                ></label
              >
              <textarea
                v-model="form.reason"
                class="field-textarea"
                rows="3"
                :maxlength="ALLOCATION_REASON_MAX_LENGTH"
                placeholder="Ex: Treinamento de modelo ML"
              ></textarea>
              <span class="field-hint text-muted"
                >{{ form.reason.length }}/{{ ALLOCATION_REASON_MAX_LENGTH }}</span
              >
            </div>
            <p v-if="formError" class="error-text">{{ formError }}</p>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" @click="showForm = false">
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary" :disabled="formSaving">
                {{ formSaving ? "Criando..." : "Criar Reserva" }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
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

.section-hint code {
  font-size: 0.78rem;
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
  max-width: 460px;
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

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.detail-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  font-size: 0.88rem;
}

</style>
