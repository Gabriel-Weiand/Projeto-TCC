<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import type { Allocation } from "@/types";
import { useLabConfigStore } from "@/stores/labConfig";
import { formatLabDate, formatLabTime } from "@/utils/datetime";

const store = useAllocationsStore();
const machinesStore = useMachinesStore();
const lab = useLabConfigStore();

const loading = ref(true);
const statusFilter = ref("all");
const listMode = ref<"active" | "hidden">("active");
const search = ref("");

async function loadAllocations() {
  loading.value = true;
  try {
    await store.fetchAllocations(
      listMode.value === "hidden"
        ? { userHidden: true, limit: 100 }
        : { limit: 100 },
    );
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    await machinesStore.fetchMachines();
    await loadAllocations();
  } catch {
    loading.value = false;
  }
});

async function setListMode(mode: "active" | "hidden") {
  if (listMode.value === mode) return;
  listMode.value = mode;
  statusFilter.value = "all";
  await loadAllocations();
}

const filtered = computed(() => {
  let list = store.allocations;
  if (statusFilter.value !== "all") {
    list = list.filter((a) => a.status === statusFilter.value);
  }
  const q = search.value.toLowerCase();
  if (q) {
    list = list.filter(
      (a) =>
        machineName(a).toLowerCase().includes(q) ||
        (a.user?.fullName || "").toLowerCase().includes(q) ||
        (a.reason || "").toLowerCase().includes(q),
    );
  }
  return list;
});

function machineName(a: Allocation) {
  if (a.machine) return a.machine.name;
  const m = machinesStore.machines.find((m) => m.id === a.machineId);
  return m ? m.name : `#${a.machineId}`;
}

function fmtDate(iso: string) {
  return formatLabDate(iso, lab.timezone);
}
function fmtTime(iso: string) {
  return formatLabTime(iso, lab.timezone);
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    pending: "badge-warning",
    approved: "badge-success",
    denied: "badge-danger",
    cancelled: "badge-muted",
    finished: "badge-info",
  };
  return map[s] || "badge-muted";
}
function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovada",
    denied: "Negada",
    cancelled: "Cancelada",
    finished: "Finalizada",
  };
  return map[s] || s;
}

const updating = ref<number | null>(null);

async function setStatus(a: Allocation, status: string) {
  const labelMap: Record<string, string> = {
    approved: "aprovar",
    denied: "negar",
    cancelled: "cancelar",
  };
  if (!confirm(`Deseja ${labelMap[status] || status} esta reserva?`)) return;
  updating.value = a.id;
  try {
    await store.updateAllocation(a.id, { status });
  } catch {
    alert("Erro ao atualizar status.");
  } finally {
    updating.value = null;
  }
}

const statusTabs = [
  { key: "all", label: "Todas" },
  { key: "pending", label: "Pendentes" },
  { key: "approved", label: "Aprovadas" },
  { key: "denied", label: "Negadas" },
  { key: "finished", label: "Finalizadas" },
  { key: "cancelled", label: "Canceladas" },
];
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Alocações</h1>
      <input
        v-model="search"
        type="text"
        placeholder="Buscar por máquina, usuário..."
        style="max-width: 260px; padding: 0.5rem 0.85rem; font-size: 0.88rem"
      />
    </div>

    <div class="list-mode-tabs">
      <button
        type="button"
        :class="['tab-btn', { active: listMode === 'active' }]"
        @click="setListMode('active')"
      >
        Alocações
      </button>
      <button
        type="button"
        :class="['tab-btn', { active: listMode === 'hidden' }]"
        @click="setListMode('hidden')"
      >
        Ocultas pelo usuário
      </button>
    </div>

    <div v-if="listMode === 'active'" class="filter-tabs">
      <button
        v-for="t in statusTabs"
        :key="t.key"
        type="button"
        :class="['tab-btn', { active: statusFilter === t.key }]"
        @click="statusFilter = t.key"
      >
        {{ t.label }}
      </button>
    </div>
    <p v-else class="hidden-hint text-muted">
      Alocações removidas do histórico do usuário (soft delete). Não aparecem na
      lista operacional acima.
    </p>

    <div v-if="loading" class="empty-state">Carregando...</div>
    <div v-else-if="filtered.length === 0" class="empty-state">
      Nenhuma alocação encontrada.
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Máquina</th>
            <th>Usuário</th>
            <th>Data</th>
            <th>Horário</th>
            <th>Status</th>
            <th>Motivo</th>
            <th style="width: 160px">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in filtered" :key="a.id">
            <td style="font-weight: 500">{{ machineName(a) }}</td>
            <td>{{ a.user?.fullName || `Usuário #${a.userId}` }}</td>
            <td class="text-secondary">{{ fmtDate(a.startTime) }}</td>
            <td class="text-secondary">
              {{ fmtTime(a.startTime) }} — {{ fmtTime(a.endTime) }}
            </td>
            <td>
              <span :class="['badge', statusBadge(a.status)]">{{
                statusLabel(a.status)
              }}</span>
              <span
                v-if="a.userHidden"
                class="badge badge-muted hidden-badge"
                >Oculta</span
              >
            </td>
            <td
              class="text-muted"
              style="
                max-width: 180px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              "
            >
              {{ a.reason || "—" }}
            </td>
            <td>
              <div
                v-if="listMode === 'hidden'"
                class="text-muted"
                style="font-size: 0.8rem; padding: 0.35rem"
              >
                Somente leitura
              </div>
              <div
                v-else
                style="display: flex; gap: 0.3rem; flex-wrap: wrap"
              >
                <template v-if="a.status === 'pending'">
                  <button
                    class="btn btn-success btn-sm"
                    :disabled="updating === a.id"
                    @click="setStatus(a, 'approved')"
                  >
                    Aprovar
                  </button>
                  <button
                    class="btn btn-danger btn-sm"
                    :disabled="updating === a.id"
                    @click="setStatus(a, 'denied')"
                  >
                    Negar
                  </button>
                </template>
                <button
                  v-if="['pending', 'approved'].includes(a.status)"
                  class="btn btn-ghost btn-sm"
                  :disabled="updating === a.id"
                  @click="setStatus(a, 'cancelled')"
                >
                  Cancelar
                </button>
                <span
                  v-if="!['pending', 'approved'].includes(a.status)"
                  class="text-muted"
                  style="font-size: 0.8rem; padding: 0.35rem"
                  >—</span
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.list-mode-tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.hidden-hint {
  font-size: 0.85rem;
  margin: 0 0 1.25rem;
}

.hidden-badge {
  margin-left: 0.35rem;
  font-size: 0.72rem;
}

.filter-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 0.4rem 0.9rem;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  transition: all var(--transition);
}
.tab-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.tab-btn.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: rgba(124, 108, 240, 0.15);
}
</style>
