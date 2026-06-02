<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import { useAllocationsStore } from "@/stores/allocations";
import { useAuthStore } from "@/stores/auth";
import { useNotificationsStore } from "@/stores/notifications";
import { useTelemetryPlayback } from "@/composables/useTelemetryPlayback";
import MachineTelemetryPanel from "@/components/MachineTelemetryPanel.vue";
import MachineLiveSections from "@/components/MachineLiveSections.vue";
import CalendarGanttScroll from "@/components/CalendarGanttScroll.vue";
import ProfileAllocationConnectModal from "@/components/ProfileAllocationConnectModal.vue";
import type { Machine, Allocation } from "@/types";
import { useRouter } from "vue-router";
import { useLabConfigStore } from "@/stores/labConfig";
import {
  wallClockToUtcIso,
  isNowBeforeUtc,
  isNowInUtcRange,
} from "@/utils/datetime";
import {
  ALLOCATION_REASON_MAX_LENGTH,
  PERIOD_INVALID_RANGE_MESSAGE,
} from "@/utils/allocationLabels";
import { isMachineAvailableForPeriod } from "@/utils/allocationAvailability";
import ReservationFormFields from "@/components/ReservationFormFields.vue";

const props = defineProps<{ id: string | number }>();
const machinesStore = useMachinesStore();
const allocationsStore = useAllocationsStore();
const auth = useAuthStore();
const notifications = useNotificationsStore();
const lab = useLabConfigStore();
const router = useRouter();

const machineId = computed(() => Number(props.id));
const machine = ref<Machine | null>(null);
const scheduleAllocations = ref<Allocation[]>([]);
const loading = ref(true);
const showForm = ref(false);
const connectTarget = ref<Allocation | null>(null);
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

const myActiveAllocation = computed(() => {
  const uid = auth.user?.id;
  if (!uid || !machine.value) return null;
  return (
    scheduleAllocations.value.find(
      (a) =>
        (a.isOwn === true || a.userId === uid) &&
        a.status === "approved" &&
        !isNowBeforeUtc(a.startTime) &&
        isNowInUtcRange(a.startTime, a.endTime),
    ) ?? null
  );
});

const connectAllocation = computed((): Allocation | null => {
  const active = myActiveAllocation.value;
  if (!active || !machine.value) return null;
  return { ...active, machine: machine.value };
});

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
const form = ref({
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  reason: "",
  isSudo: false,
});
const formSaving = ref(false);
const formError = ref("");

const periodFilled = computed(
  () =>
    !!form.value.startDate &&
    !!form.value.startTime &&
    !!form.value.endDate &&
    !!form.value.endTime,
);

const formRangeIso = computed((): { start: string; end: string } | null => {
  if (!periodFilled.value) return null;
  try {
    const start = wallClockToUtcIso(
      form.value.startDate,
      form.value.startTime,
      lab.timezone,
    );
    const end = wallClockToUtcIso(
      form.value.endDate,
      form.value.endTime,
      lab.timezone,
    );
    if (end <= start) return null;
    return { start, end };
  } catch {
    return null;
  }
});

const periodInvalid = computed(
  () => periodFilled.value && !formRangeIso.value,
);

const periodAvailable = computed(() => {
  if (!machine.value || !formRangeIso.value) return null;
  return isMachineAvailableForPeriod(
    machine.value,
    scheduleAllocations.value,
    formRangeIso.value.start,
    formRangeIso.value.end,
  );
});

const canCreateReservation = computed(() => {
  if (formSaving.value || !periodFilled.value || !formRangeIso.value) {
    return false;
  }
  return periodAvailable.value === true;
});

function openForm() {
  form.value = {
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    reason: "",
    isSudo: false,
  };
  formError.value = "";
  showForm.value = true;
}

function openConnect() {
  if (connectAllocation.value) {
    connectTarget.value = connectAllocation.value;
  }
}

async function handleCreate() {
  if (!machine.value) return;
  formError.value = "";

  if (!canCreateReservation.value) {
    if (!periodFilled.value) {
      formError.value = "Preencha todos os campos obrigatórios.";
    } else if (!formRangeIso.value) {
      formError.value = PERIOD_INVALID_RANGE_MESSAGE;
    } else {
      formError.value = "Máquina indisponível no período selecionado.";
    }
    return;
  }

  const startTime = formRangeIso.value!.start;
  const endTime = formRangeIso.value!.end;

  formSaving.value = true;
  try {
    await allocationsStore.createAllocation({
      machineId: machine.value.id,
      startTime,
      endTime,
      reason:
        form.value.reason.trim().slice(0, ALLOCATION_REASON_MAX_LENGTH) ||
        undefined,
      isSudo: auth.isAdmin ? undefined : form.value.isSudo,
    });
    showForm.value = false;
    const [sched] = await Promise.all([
      machinesStore.fetchMachineAllocations(machineId.value, { limit: 200 }),
      notifications.fetchNotifications(),
    ]);
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
            v-if="connectAllocation"
            type="button"
            class="btn btn-primary btn-sm"
            @click="openConnect"
          >
            Conectar SSH
          </button>
          <button
            v-if="machine.status !== 'maintenance'"
            class="btn btn-primary btn-sm"
            @click="openForm"
          >
            + Reservar
          </button>
        </div>
      </div>

      <div
        v-if="connectAllocation && machine.hostFingerprint"
        class="ssh-banner card"
      >
        <span class="text-muted">Fingerprint do host (SSH)</span>
        <code class="ssh-banner-fp">{{ machine.hostFingerprint }}</code>
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
          <form class="modal-body reservation-modal-form" @submit.prevent="handleCreate">
            <ReservationFormFields
              v-model:start-date="form.startDate"
              v-model:start-time="form.startTime"
              v-model:end-date="form.endDate"
              v-model:end-time="form.endTime"
              v-model:reason="form.reason"
              v-model:is-sudo="form.isSudo"
              :show-sudo="!auth.isAdmin"
              :period-ready="!!formRangeIso"
              :period-invalid="periodInvalid"
            />

            <p v-if="formError" class="error-text">{{ formError }}</p>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" @click="showForm = false">
                Cancelar
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="!canCreateReservation"
              >
                {{ formSaving ? "Criando..." : "Criar Reserva" }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <ProfileAllocationConnectModal
      v-if="connectTarget"
      :allocation="connectTarget"
      @close="connectTarget = null"
    />
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

.ssh-banner {
  margin-bottom: 1.25rem;
  padding: 0.85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ssh-banner-fp {
  font-size: 0.78rem;
  word-break: break-all;
  line-height: 1.4;
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

.reservation-modal-form {
  gap: 0.85rem;
}

.modal-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.65rem;
  margin-top: 0.25rem;
}

.modal-actions .btn {
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  min-height: 2.35rem;
}

.error-text {
  margin: 0;
  font-size: 0.88rem;
}

.detail-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  font-size: 0.88rem;
}

</style>
