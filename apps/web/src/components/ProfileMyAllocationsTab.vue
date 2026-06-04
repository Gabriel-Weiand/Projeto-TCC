<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useNotificationsStore } from "@/stores/notifications";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation } from "@/types";
import AllocationUsageStatsModal from "@/components/AllocationUsageStatsModal.vue";
import ProfileAllocationConnectModal from "@/components/ProfileAllocationConnectModal.vue";
import ExtendAllocationOverlay from "@/components/ExtendAllocationOverlay.vue";
import MyAllocationDetailPanel from "@/components/MyAllocationDetailPanel.vue";
import AllocationListToolbar from "@/components/AllocationListToolbar.vue";
import {
  ALLOCATION_STATUS_FILTER_TABS,
  allocationFilterParams,
  refineApprovedFilterResults,
} from "@/constants/allocationFilters";
import {
  allocationListStatusBadge,
  allocationListStatusLabel,
  fmtAllocationDateTime,
} from "@/utils/allocationLabels";
import { useMyAllocationActions } from "@/composables/useMyAllocationActions";
import { effectiveLifecycleStatus } from "@/utils/allocationLifecycle";

const store = useAllocationsStore();
const notifications = useNotificationsStore();
const lab = useLabConfigStore();

const loading = ref(true);
const list = ref<Allocation[]>([]);
const statusFilter = ref("all");
const search = ref("");
const updating = ref<number | null>(null);
const detailTarget = ref<Allocation | null>(null);
const connectTarget = ref<Allocation | null>(null);
const extendTarget = ref<Allocation | null>(null);
const usageStatsTarget = ref<Allocation | null>(null);
const deleting = ref<number | null>(null);

function fmt(iso: string) {
  return fmtAllocationDateTime(iso, lab.timezone);
}

const {
  canCancel,
  showConnectButton,
  canConnectNow,
  connectDisabledTitle,
  showExtendButton,
  showFinishButton,
  showStatistics,
  canRemoveFromHistory,
  hasActions,
  finishConfirmMessage,
} = useMyAllocationActions();

function lifecycle(a: Allocation) {
  return effectiveLifecycleStatus(a, lab.allocationAccess);
}

const listStatusOptions = computed(() => ({
  graceEnabled: lab.graceEnabled,
  postSftpEnabled: lab.postSftpEnabled,
}));

onMounted(async () => {
  if (!lab.loaded) await lab.fetchConfig();
  void loadList();
});

async function loadList() {
  loading.value = true;
  try {
    const params = allocationFilterParams(statusFilter.value);
    list.value = await store.fetchMyAllocations(params);
  } finally {
    loading.value = false;
  }
}

async function onFilterChange(key: string) {
  statusFilter.value = key;
  await loadList();
}

const filtered = computed(() => {
  let rows = refineApprovedFilterResults(
    list.value,
    statusFilter.value,
    lifecycle,
  );
  const q = search.value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((a) => machineName(a).toLowerCase().includes(q));
});

function machineName(a: Allocation) {
  return a.machine?.name ?? `Máquina #${a.machineId}`;
}

function openDetail(a: Allocation) {
  detailTarget.value = a;
}

function closeDetail() {
  detailTarget.value = null;
}

function openConnect(a: Allocation) {
  closeDetail();
  connectTarget.value = a;
}

function openExtend(a: Allocation) {
  closeDetail();
  extendTarget.value = a;
}

function openStatistics(a: Allocation) {
  closeDetail();
  usageStatsTarget.value = a;
}

async function handleFinish(a: Allocation) {
  if (!confirm(finishConfirmMessage())) {
    return;
  }
  updating.value = a.id;
  try {
    const updated = await store.finishAllocation(a.id);
    const idx = list.value.findIndex((x) => x.id === updated.id);
    if (idx !== -1) list.value[idx] = updated;
    if (detailTarget.value?.id === updated.id) detailTarget.value = updated;
    await notifications.fetchNotifications();
  } catch {
    alert("Erro ao finalizar sessão.");
  } finally {
    updating.value = null;
  }
}

async function handleCancel(a: Allocation) {
  if (!confirm("Deseja cancelar esta reserva?")) return;
  updating.value = a.id;
  try {
    const updated = await store.cancelAllocation(a.id);
    const idx = list.value.findIndex((x) => x.id === updated.id);
    if (idx !== -1) list.value[idx] = updated;
    if (detailTarget.value?.id === updated.id) detailTarget.value = updated;
    await notifications.fetchNotifications();
  } catch {
    alert("Erro ao cancelar reserva.");
  } finally {
    updating.value = null;
  }
}

async function onExtended(updated: Allocation) {
  const idx = list.value.findIndex((x) => x.id === updated.id);
  if (idx !== -1) list.value[idx] = updated;
  if (detailTarget.value?.id === updated.id) detailTarget.value = updated;
  await notifications.fetchNotifications();
}

async function handleDelete(a: Allocation) {
  if (!confirm("Remover esta alocação do seu histórico?")) return;
  deleting.value = a.id;
  try {
    await store.softDeleteAllocation(a.id);
    list.value = list.value.filter((x) => x.id !== a.id);
    if (detailTarget.value?.id === a.id) closeDetail();
  } catch {
    alert("Erro ao remover alocação.");
  } finally {
    deleting.value = null;
  }
}
</script>

<template>
  <div class="allocation-list">
    <AllocationListToolbar
      :tabs="ALLOCATION_STATUS_FILTER_TABS"
      :active-key="statusFilter"
      :search="search"
      search-placeholder="Buscar por máquina..."
      @filter="onFilterChange"
      @update:search="search = $event"
    />

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
            <td class="text-secondary alloc-datetime">{{ fmt(a.startTime) }}</td>
            <td class="text-secondary alloc-datetime">{{ fmt(a.endTime) }}</td>
            <td>
              <span
                :class="[
                  'badge',
                  allocationListStatusBadge(a.status, lifecycle(a), listStatusOptions),
                ]"
              >
                {{ allocationListStatusLabel(a.status, lifecycle(a), listStatusOptions) }}
              </span>
            </td>
            <td class="alloc-actions">
              <div v-if="hasActions(a)" class="actions-row">
                <button
                  v-if="showExtendButton(a)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-action"
                  @click.stop="openExtend(a)"
                >
                  Estender
                </button>
                <button
                  v-if="showFinishButton(a)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-action"
                  :disabled="updating === a.id"
                  @click.stop="handleFinish(a)"
                >
                  Finalizar
                </button>
                <button
                  v-if="canCancel(a)"
                  type="button"
                  class="btn btn-danger btn-sm btn-action"
                  :disabled="updating === a.id"
                  @click.stop="handleCancel(a)"
                >
                  Cancelar
                </button>
                <button
                  v-if="showConnectButton(a)"
                  type="button"
                  class="btn btn-primary btn-sm btn-action"
                  :class="{ 'btn-action--waiting': !canConnectNow(a) }"
                  :disabled="!canConnectNow(a)"
                  :title="connectDisabledTitle(a)"
                  @click.stop="openConnect(a)"
                >
                  Conectar
                </button>
                <button
                  v-if="showStatistics(a)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-action"
                  @click.stop="openStatistics(a)"
                >
                  Estatísticas
                </button>
                <button
                  v-if="canRemoveFromHistory(a)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-action"
                  :disabled="deleting === a.id"
                  @click.stop="handleDelete(a)"
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

    <MyAllocationDetailPanel
      v-if="detailTarget"
      :allocation="detailTarget"
      :updating="updating === detailTarget.id"
      :deleting="deleting === detailTarget.id"
      @close="closeDetail"
      @connect="openConnect(detailTarget)"
      @extend="openExtend(detailTarget)"
      @statistics="openStatistics(detailTarget)"
      @cancel="handleCancel(detailTarget)"
      @finish="handleFinish(detailTarget)"
      @delete="handleDelete(detailTarget)"
    />

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
