<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import { useAuthStore } from "@/stores/auth";
import { useTelemetryPlayback } from "@/composables/useTelemetryPlayback";
import { pickNewerTelemetry } from "@/utils/telemetryBatchDiff";
import MachineTelemetryPanel from "@/components/MachineTelemetryPanel.vue";
import MachineLiveSections from "@/components/MachineLiveSections.vue";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import ProfileAllocationConnectModal from "@/components/ProfileAllocationConnectModal.vue";
import type { Machine, Allocation } from "@/types";
import { useRoute, useRouter } from "vue-router";
import { isNowBeforeUtc, isNowInUtcRange } from "@/utils/datetime";
import { displayTotalDiskGb } from "@/utils/machineDisks";

const props = defineProps<{ id: string | number }>();
const machinesStore = useMachinesStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const fromAdmin = computed(() => route.query.from === "admin");

const machineId = computed(() => Number(props.id));
const machine = ref<Machine | null>(null);
const scheduleAllocations = ref<Allocation[]>([]);
const loading = ref(true);
const connectTarget = ref<Allocation | null>(null);
const usersCollapsed = ref(false);

const isAdmin = computed(() => auth.user?.role === "admin");

const {
  current: telemetry,
  latestProcesses,
  latestBatchTimestamp,
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
    if (isAdmin.value) startPlayback();

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

const liveData = computed(() =>
  pickNewerTelemetry(telemetry.value, machine.value?.latestTelemetry ?? null),
);

const displayProcesses = computed(
  () => latestProcesses.value ?? liveData.value?.processes ?? null,
);

const showLiveSections = computed(
  () =>
    isAdmin.value ||
    (machine.value?.disks != null && machine.value.disks.length > 0),
);

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

function goBack() {
  router.push({ name: fromAdmin.value ? "admin-machines" : "machines" });
}

function goToReserve() {
  if (!machine.value || machine.value.status === "maintenance") return;
  router.push({
    name: "home",
    query: { machine: String(machine.value.id), reserve: "1" },
  });
}

function goToEdit() {
  if (!machine.value) return;
  router.push({
    name: "admin-machine-edit",
    params: { id: machine.value.id },
    query: { from: "machine-detail" },
  });
}

function openConnect() {
  if (connectAllocation.value) {
    connectTarget.value = connectAllocation.value;
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

const displayDiskGb = computed(() =>
  machine.value ? displayTotalDiskGb(machine.value) : null,
);
</script>

<template>
  <div class="fade-in">
    <button
      class="btn btn-ghost btn-sm"
      style="margin-bottom: 1rem"
      @click="goBack"
    >
      ← Voltar
    </button>

    <div v-if="loading" class="empty-state">Carregando...</div>

    <template v-else-if="machine">
      <div class="detail-header">
        <div class="detail-header-top">
          <div class="detail-title-row">
            <h1 class="page-title">{{ machine.name }}</h1>
            <span
              :class="['badge', 'machine-status-badge', statusBadge(machine.status)]"
            >
              {{ statusLabel(machine.status) }}
            </span>
          </div>
          <div class="header-actions">
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
              @click="goToReserve"
            >
              + Reservar
            </button>
            <button
              v-if="isAdmin"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="goToEdit"
            >
              Editar
            </button>
          </div>
        </div>
        <p class="text-secondary machine-description">
          {{ machine.description || "Sem descrição" }}
        </p>
      </div>

      <div
        v-if="connectAllocation && machine.hostFingerprint"
        class="ssh-banner card"
      >
        <span class="text-muted">Fingerprint do host (SSH)</span>
        <code class="ssh-banner-fp">{{ machine.hostFingerprint }}</code>
      </div>

      <div class="specs-grid">
        <div class="stat-card">
          <span class="stat-label">CPU</span>
          <span class="stat-value" style="font-size: 1rem">
            {{ machine.cpuModel || "—" }}
          </span>
          <span v-if="!machine.cpuModel" class="stat-sub text-muted">Aguardando sync</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">GPU</span>
          <span class="stat-value" style="font-size: 1rem">
            {{ machine.gpuModel || "—" }}
          </span>
          <span v-if="machine.totalVramGb" class="stat-sub text-muted">
            {{ machine.totalVramGb }} GB VRAM
          </span>
          <span v-else-if="!machine.gpuModel" class="stat-sub text-muted">Aguardando sync</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">RAM</span>
          <span class="stat-value">{{ machine.totalRamGb ? `${machine.totalRamGb} GB` : "—" }}</span>
          <span v-if="!machine.totalRamGb" class="stat-sub text-muted">Aguardando sync</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Disco</span>
          <span class="stat-value">
            {{ displayDiskGb ? `${displayDiskGb} GB` : "—" }}
          </span>
          <span v-if="!displayDiskGb" class="stat-sub text-muted">Aguardando sync</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">IP local</span>
          <span class="stat-value" style="font-size: 1rem">
            {{ machine.ipAddress || "—" }}
          </span>
          <span v-if="!machine.ipAddress" class="stat-sub text-muted">Aguardando sync</span>
        </div>
      </div>

      <MachineLiveSections
        v-if="showLiveSections"
        :machine="machine"
        :machine-id="machineId"
        :live-data="liveData"
        :show-telemetry="isAdmin"
        :show-charts="isAdmin"
        :show-processes="isAdmin"
        :latest-processes="displayProcesses"
        :latest-batch-timestamp="latestBatchTimestamp"
      />

      <template v-if="isAdmin">
        <CollapsibleSection v-model:collapsed="usersCollapsed" title="Usuários">
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
        <div v-else class="users-empty">
          Nenhuma sessão ativa no momento.
        </div>
        </CollapsibleSection>
      </template>
    </template>

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
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1.5rem;
}

.detail-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
}

.detail-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem;
  min-width: 0;
}

.detail-title-row .page-title {
  margin: 0;
  line-height: 1.2;
}

.detail-title-row .machine-status-badge {
  align-self: center;
}

.machine-status-badge {
  font-size: 0.72rem;
  padding: 0.28rem 0.7rem;
  line-height: 1.25;
}

.machine-description {
  font-size: 0.9rem;
  margin: 0;
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

.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.section-spaced {
  margin-top: 2rem;
}

.users-table-wrap {
  margin-bottom: 1rem;
}

.users-empty {
  padding: 1rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  text-align: center;
}

</style>
