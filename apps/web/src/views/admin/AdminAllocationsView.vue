<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import type { Allocation } from "@/types";

const store = useAllocationsStore();
const machinesStore = useMachinesStore();

const loading = ref(true);
const statusFilter = ref("all");
const search = ref("");

onMounted(async () => {
  try {
    await Promise.all([
      store.fetchAllocations(),
      machinesStore.fetchMachines(),
    ]);
  } finally {
    loading.value = false;
  }
});

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

const tabs = [
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

    <!-- Filter tabs -->
    <div class="filter-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="['tab-btn', { active: statusFilter === t.key }]"
        @click="statusFilter = t.key"
      >
        {{ t.label }}
      </button>
    </div>

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
              <div style="display: flex; gap: 0.3rem; flex-wrap: wrap">
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
