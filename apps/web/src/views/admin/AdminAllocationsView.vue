<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation } from "@/types";
import MyAllocationDetailPanel from "@/components/MyAllocationDetailPanel.vue";
import AllocationUsageStatsModal from "@/components/AllocationUsageStatsModal.vue";
import AllocationListToolbar from "@/components/AllocationListToolbar.vue";
import {
  ADMIN_ALLOCATION_FILTER_TABS,
  allocationFilterParams,
  isHiddenAllocationsFilter,
  refineApprovedFilterResults,
} from "@/constants/allocationFilters";
import {
  adminAllocationStatusBadge,
  adminAllocationStatusLabel,
  fmtAllocationDateTime,
} from "@/utils/allocationLabels";
import { effectiveLifecycleStatus } from "@/utils/allocationLifecycle";
import { useAdminAllocationActions } from "@/composables/useAdminAllocationActions";
import ExtendAllocationOverlay from "@/components/ExtendAllocationOverlay.vue";

const store = useAllocationsStore();
const machinesStore = useMachinesStore();
const lab = useLabConfigStore();

const loading = ref(true);
const statusFilter = ref("all");
const search = ref("");
const detailTarget = ref<Allocation | null>(null);
const usageStatsTarget = ref<Allocation | null>(null);
const updating = ref<number | null>(null);
const deleting = ref<number | null>(null);
const summarizing = ref<number | null>(null);
const editTarget = ref<Allocation | null>(null);

const isHiddenList = computed(() => isHiddenAllocationsFilter(statusFilter.value));

function lifecycle(a: Allocation) {
  return effectiveLifecycleStatus(a, lab.allocationAccess);
}

const adminStatusOptions = computed(() => ({
  graceEnabled: lab.graceEnabled,
  postSftpEnabled: lab.postSftpEnabled,
}));

const adminActions = useAdminAllocationActions(lifecycle);

async function loadAllocations() {
  loading.value = true;
  try {
    const params = allocationFilterParams(statusFilter.value) ?? { limit: 100 };
    await store.fetchAllocations(params);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    if (!lab.loaded) await lab.fetchConfig();
    await machinesStore.fetchMachines();
    await loadAllocations();
  } catch {
    loading.value = false;
  }
});

async function onFilterChange(key: string) {
  statusFilter.value = key;
  detailTarget.value = null;
  await loadAllocations();
}

const filtered = computed(() => {
  let rows = refineApprovedFilterResults(
    store.allocations,
    statusFilter.value,
    lifecycle,
  );
  const q = search.value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (a) =>
      machineName(a).toLowerCase().includes(q) ||
      (a.user?.fullName || "").toLowerCase().includes(q) ||
      (a.reason || "").toLowerCase().includes(q),
  );
});

function machineName(a: Allocation) {
  if (a.machine) return a.machine.name;
  const m = machinesStore.machines.find((m) => m.id === a.machineId);
  return m ? m.name : `#${a.machineId}`;
}

function enrichAllocation(a: Allocation): Allocation {
  return {
    ...a,
    machine:
      a.machine ??
      machinesStore.machines.find((m) => m.id === a.machineId) ??
      undefined,
  };
}

function fmt(iso: string) {
  return fmtAllocationDateTime(iso, lab.timezone);
}

function openDetail(a: Allocation) {
  detailTarget.value = enrichAllocation(a);
}

function closeDetail() {
  detailTarget.value = null;
}

function syncDetailFromStore() {
  if (!detailTarget.value) return;
  const updated = store.allocations.find((a) => a.id === detailTarget.value!.id);
  if (updated) {
    detailTarget.value = enrichAllocation(updated);
  } else {
    detailTarget.value = null;
  }
}

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
    syncDetailFromStore();
  } catch {
    alert("Erro ao atualizar status.");
  } finally {
    updating.value = null;
  }
}

async function handleGenerateSummary(a: Allocation) {
  if (!confirm("Gerar resumo de telemetria desta sessão?")) return;
  summarizing.value = a.id;
  try {
    await store.generateAllocationSummary(a.id);
    syncDetailFromStore();
  } catch (err: unknown) {
    const code = (err as { response?: { data?: { code?: string } } })?.response
      ?.data?.code;
    if (code === "SUMMARY_EXISTS") alert("Esta alocação já possui um resumo.");
    else if (code === "NO_TELEMETRY")
      alert("Não há telemetria para gerar o resumo.");
    else alert("Erro ao gerar resumo.");
  } finally {
    summarizing.value = null;
  }
}

function openEdit(a: Allocation) {
  editTarget.value = enrichAllocation(a);
}

function onAllocationEdited(updated: Allocation) {
  const idx = store.allocations.findIndex((row) => row.id === updated.id);
  if (idx !== -1) store.allocations[idx] = updated;
  syncDetailFromStore();
  editTarget.value = null;
}

async function handleHardDelete(a: Allocation) {
  if (
    !confirm(
      "Remover permanentemente esta alocação?\n\nTelemetrias e resumo da sessão serão apagados. Esta ação não pode ser desfeita.",
    )
  )
    return;
  deleting.value = a.id;
  try {
    await store.hardDeleteAllocation(a.id);
    if (detailTarget.value?.id === a.id) detailTarget.value = null;
  } catch {
    alert("Erro ao remover alocação.");
  } finally {
    deleting.value = null;
  }
}

function openStatistics(a: Allocation) {
  usageStatsTarget.value = enrichAllocation(a);
}
</script>

<template>
  <div class="fade-in allocations-page">
    <div class="page-header">
      <h1 class="page-title">Alocações</h1>
    </div>

    <div class="card allocations-card">
      <div class="allocation-list">
        <AllocationListToolbar
          :tabs="ADMIN_ALLOCATION_FILTER_TABS"
          :active-key="statusFilter"
          :search="search"
          search-placeholder="Buscar por máquina, usuário..."
          @filter="onFilterChange"
          @update:search="search = $event"
        />

        <p v-if="isHiddenList" class="hidden-hint text-muted">
          Alocações removidas do histórico do usuário (soft delete). Não aparecem
          na lista operacional.
        </p>

        <div v-if="loading" class="empty-state">Carregando...</div>
        <div v-else-if="filtered.length === 0" class="empty-state">
          Nenhuma alocação encontrada.
        </div>

        <div v-else class="table-wrap">
          <table class="alloc-table">
            <thead>
              <tr>
                <th>Máquina</th>
                <th>Usuário</th>
                <th>Início</th>
                <th>Fim</th>
                <th>Status</th>
                <th class="col-actions col-actions--admin">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="a in filtered"
                :key="a.id"
                class="alloc-row"
                tabindex="0"
                :aria-label="`Ver detalhes da reserva em ${machineName(a)}`"
                @click="openDetail(a)"
                @keydown.enter="openDetail(a)"
                @keydown.space.prevent="openDetail(a)"
              >
                <td class="alloc-machine">{{ machineName(a) }}</td>
                <td>{{ a.user?.fullName || `Usuário #${a.userId}` }}</td>
                <td class="text-secondary alloc-datetime">{{ fmt(a.startTime) }}</td>
                <td class="text-secondary alloc-datetime">{{ fmt(a.endTime) }}</td>
                <td>
                  <span
                    :class="[
                      'badge',
                      adminAllocationStatusBadge(
                        a.status,
                        lifecycle(a),
                        a.userHidden,
                        adminStatusOptions,
                      ),
                    ]"
                  >
                    {{
                      adminAllocationStatusLabel(
                        a.status,
                        lifecycle(a),
                        a.userHidden,
                        adminStatusOptions,
                      )
                    }}
                  </span>
                </td>
                <td class="alloc-actions">
                  <div
                    v-if="adminActions.hasActions(a, isHiddenList)"
                    class="actions-row"
                  >
                    <button
                      v-if="adminActions.canApproveDeny(a)"
                      type="button"
                      class="btn btn-sm btn-action btn-approve-outline"
                      :disabled="updating === a.id"
                      @click.stop="setStatus(a, 'approved')"
                    >
                      Aprovar
                    </button>
                    <button
                      v-if="adminActions.canApproveDeny(a)"
                      type="button"
                      class="btn btn-danger btn-sm btn-action"
                      :disabled="updating === a.id"
                      @click.stop="setStatus(a, 'denied')"
                    >
                      Negar
                    </button>
                    <button
                      v-if="adminActions.canEdit(a)"
                      type="button"
                      class="btn btn-ghost btn-sm btn-action"
                      @click.stop="openEdit(a)"
                    >
                      Editar
                    </button>
                    <button
                      v-if="adminActions.canCancel(a)"
                      type="button"
                      class="btn btn-ghost btn-sm btn-action"
                      :disabled="updating === a.id"
                      @click.stop="setStatus(a, 'cancelled')"
                    >
                      Cancelar
                    </button>
                    <button
                      v-if="adminActions.canGenerateSummary(a)"
                      type="button"
                      class="btn btn-ghost btn-sm btn-action"
                      :disabled="summarizing === a.id"
                      @click.stop="handleGenerateSummary(a)"
                    >
                      {{ summarizing === a.id ? "Gerando…" : "Gerar resumo" }}
                    </button>
                    <button
                      v-if="adminActions.canViewStatistics(a)"
                      type="button"
                      class="btn btn-ghost btn-sm btn-action"
                      @click.stop="openStatistics(a)"
                    >
                      Estatísticas
                    </button>
                    <button
                      v-if="adminActions.canHardDelete(a)"
                      type="button"
                      class="btn btn-danger btn-sm btn-action"
                      :disabled="deleting === a.id"
                      @click.stop="handleHardDelete(a)"
                    >
                      Excluir
                    </button>
                  </div>
                  <span v-else class="text-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <MyAllocationDetailPanel
      v-if="detailTarget"
      admin-mode
      :admin-readonly="isHiddenList"
      :allocation="detailTarget"
      :updating="updating === detailTarget.id"
      :deleting="deleting === detailTarget.id"
      :summarizing="summarizing === detailTarget.id"
      @close="closeDetail"
      @approve="setStatus(detailTarget, 'approved')"
      @deny="setStatus(detailTarget, 'denied')"
      @cancel="setStatus(detailTarget, 'cancelled')"
      @generate-summary="handleGenerateSummary(detailTarget)"
      @statistics="openStatistics(detailTarget)"
      @edit="openEdit(detailTarget)"
      @delete="handleHardDelete(detailTarget)"
    />

    <ExtendAllocationOverlay
      v-if="editTarget"
      admin-mode
      :allocation="editTarget"
      @close="editTarget = null"
      @extended="onAllocationEdited"
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
.allocations-page {
  max-width: 1280px;
  margin: 0 auto;
}

.allocations-card {
  padding: 1.25rem 1.5rem;
  text-align: left;
}
</style>
