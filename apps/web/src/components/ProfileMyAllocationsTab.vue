<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation } from "@/types";
import AllocationUsageStatsModal from "@/components/AllocationUsageStatsModal.vue";
import ProfileAllocationConnectModal from "@/components/ProfileAllocationConnectModal.vue";
import ExtendAllocationOverlay from "@/components/ExtendAllocationOverlay.vue";
import {
  allocationStatusBadge,
  allocationStatusLabel,
  fmtAllocationDateTime,
} from "@/utils/allocationLabels";
import {
  isNowBeforeUtc,
  isNowInUtcRange,
  isNowWithinGraceAfterEnd,
} from "@/utils/datetime";

const store = useAllocationsStore();
const lab = useLabConfigStore();

const loading = ref(true);
const list = ref<Allocation[]>([]);
const statusFilter = ref("all");
const search = ref("");
const updating = ref<number | null>(null);
const connectTarget = ref<Allocation | null>(null);
const extendTarget = ref<Allocation | null>(null);
const usageStatsTarget = ref<Allocation | null>(null);
const deleting = ref<number | null>(null);

const GRACE_MINUTES = 5;

const filterTabs = [
  { key: "all", label: "Todas" },
  { key: "pending", label: "Pendentes" },
  { key: "approved", label: "Aprovadas" },
  { key: "denied", label: "Negadas" },
  { key: "finished", label: "Finalizadas" },
  { key: "cancelled", label: "Canceladas" },
];

function fmt(iso: string) {
  return fmtAllocationDateTime(iso, lab.timezone);
}

onMounted(() => void loadList());

async function loadList() {
  loading.value = true;
  try {
    list.value = await store.fetchMyAllocations(
      statusFilter.value !== "all" ? { status: statusFilter.value } : undefined,
    );
  } finally {
    loading.value = false;
  }
}

async function onFilterChange(key: string) {
  statusFilter.value = key;
  await loadList();
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return list.value;
  return list.value.filter((a) => machineName(a).toLowerCase().includes(q));
});

function machineName(a: Allocation) {
  return a.machine?.name ?? `Máquina #${a.machineId}`;
}

function canCancel(a: Allocation) {
  return ["pending", "approved"].includes(a.status);
}

function showConnectButton(a: Allocation) {
  return a.status === "approved";
}

function canConnectNow(a: Allocation) {
  return (
    a.status === "approved" &&
    !isNowBeforeUtc(a.startTime) &&
    isNowInUtcRange(a.startTime, a.endTime)
  );
}

function showExtendButton(a: Allocation) {
  return (
    a.status === "approved" &&
    isNowWithinGraceAfterEnd(a.endTime, GRACE_MINUTES)
  );
}

function showStatistics(a: Allocation) {
  return a.status === "finished";
}

function canRemoveFromHistory(a: Allocation) {
  return ["finished", "cancelled", "denied"].includes(a.status);
}

function hasActions(a: Allocation) {
  return (
    canCancel(a) ||
    showConnectButton(a) ||
    showExtendButton(a) ||
    showStatistics(a) ||
    canRemoveFromHistory(a)
  );
}

async function handleCancel(a: Allocation) {
  if (!confirm("Deseja cancelar esta reserva?")) return;
  updating.value = a.id;
  try {
    const updated = await store.cancelAllocation(a.id);
    const idx = list.value.findIndex((x) => x.id === updated.id);
    if (idx !== -1) list.value[idx] = updated;
  } catch {
    alert("Erro ao cancelar reserva.");
  } finally {
    updating.value = null;
  }
}

function onExtended(updated: Allocation) {
  const idx = list.value.findIndex((x) => x.id === updated.id);
  if (idx !== -1) list.value[idx] = updated;
}

async function handleDelete(a: Allocation) {
  if (!confirm("Remover esta alocação do seu histórico?")) return;
  deleting.value = a.id;
  try {
    await store.softDeleteAllocation(a.id);
    list.value = list.value.filter((x) => x.id !== a.id);
  } catch {
    alert("Erro ao remover alocação.");
  } finally {
    deleting.value = null;
  }
}
</script>

<template>
  <div class="my-allocations">
    <div class="my-allocations-toolbar">
      <input
        v-model="search"
        type="search"
        placeholder="Buscar por máquina..."
        class="search-input"
      />
    </div>

    <div class="filter-tabs">
      <button
        v-for="t in filterTabs"
        :key="t.key"
        type="button"
        :class="['tab-btn', { active: statusFilter === t.key }]"
        @click="onFilterChange(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading" class="empty-state">Carregando suas reservas...</div>
    <div v-else-if="filtered.length === 0" class="empty-state">
      Nenhuma alocação encontrada.
    </div>

    <div v-else class="table-wrap">
      <table class="alloc-table">
        <thead>
          <tr>
            <th>Máquina</th>
            <th>Início</th>
            <th>Fim</th>
            <th>Status</th>
            <th class="col-actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in filtered" :key="a.id">
            <td class="alloc-machine">{{ machineName(a) }}</td>
            <td class="text-secondary alloc-datetime">{{ fmt(a.startTime) }}</td>
            <td class="text-secondary alloc-datetime">{{ fmt(a.endTime) }}</td>
            <td>
              <span :class="['badge', allocationStatusBadge(a.status)]">
                {{ allocationStatusLabel(a.status) }}
              </span>
            </td>
            <td class="alloc-actions">
              <div v-if="hasActions(a)" class="actions-row">
                <button
                  v-if="showExtendButton(a)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-action"
                  @click="extendTarget = a"
                >
                  Estender
                </button>
                <button
                  v-if="canCancel(a)"
                  type="button"
                  class="btn btn-danger btn-sm btn-action"
                  :disabled="updating === a.id"
                  @click="handleCancel(a)"
                >
                  Cancelar
                </button>
                <button
                  v-if="showConnectButton(a)"
                  type="button"
                  class="btn btn-primary btn-sm btn-action"
                  :class="{ 'btn-action--waiting': !canConnectNow(a) }"
                  :disabled="!canConnectNow(a)"
                  :title="
                    isNowBeforeUtc(a.startTime)
                      ? 'Disponível após o horário de início'
                      : !canConnectNow(a)
                        ? 'Fora do período da reserva'
                        : 'Conectar via SSH'
                  "
                  @click="connectTarget = a"
                >
                  Conectar
                </button>
                <button
                  v-if="showStatistics(a)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-action"
                  @click="usageStatsTarget = a"
                >
                  Estatísticas
                </button>
                <button
                  v-if="canRemoveFromHistory(a)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-action"
                  :disabled="deleting === a.id"
                  @click="handleDelete(a)"
                >
                  Remover
                </button>
              </div>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ProfileAllocationConnectModal
      v-if="connectTarget"
      :allocation="connectTarget"
      @close="connectTarget = null"
    />
    <ExtendAllocationOverlay
      v-if="extendTarget"
      :allocation="extendTarget"
      @close="extendTarget = null"
      @extended="onExtended"
    />
    <AllocationUsageStatsModal
      v-if="usageStatsTarget"
      :allocation="usageStatsTarget"
      :machine-label="machineName(usageStatsTarget)"
      @close="usageStatsTarget = null"
    />
  </div>
</template>

<style scoped>
.my-allocations {
  width: 100%;
}

.my-allocations-toolbar {
  margin-bottom: 1rem;
}

.search-input {
  width: 100%;
  max-width: 320px;
  padding: 0.5rem 0.85rem;
  font-size: 0.88rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
}

.filter-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1.25rem;
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
  cursor: pointer;
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

.alloc-table {
  width: 100%;
}

.alloc-machine {
  font-weight: 500;
}

.alloc-datetime {
  font-size: 0.88rem;
  white-space: nowrap;
}

.col-actions {
  width: 1%;
  white-space: nowrap;
}

.alloc-actions {
  vertical-align: middle;
}

.actions-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.35rem;
  justify-content: flex-end;
  align-items: center;
}

.btn-action {
  padding: 0.3rem 0.55rem;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.btn-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-action--waiting:disabled {
  opacity: 0.35;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  box-shadow: none;
}
</style>
