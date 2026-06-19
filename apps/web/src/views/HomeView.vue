<script setup lang="ts">
import CalendarGanttScroll from "@/components/CalendarGanttScroll.vue";
import ReservationFormFields from "@/components/ReservationFormFields.vue";
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import { useAuthStore } from "@/stores/auth";
import { useLabConfigStore } from "@/stores/labConfig";
import { useNotificationsStore } from "@/stores/notifications";
import { useUsersStore } from "@/stores/users";
import type { Allocation, Machine } from "@/types";
import { wallClockToUtcIso } from "@/utils/datetime";
import {
  ALLOCATION_REASON_MAX_LENGTH,
  allocationApiErrorMessage,
  PERIOD_END_TOO_FAR_MESSAGE,
  PERIOD_IN_PAST_MESSAGE,
  PERIOD_INVALID_RANGE_MESSAGE,
  periodTooShortMessage,
} from "@/utils/allocationLabels";
import { serverNowMs } from "@/services/timeSync";
import { isMachineAvailableForPeriod } from "@/utils/allocationAvailability";
import {
  isAllocationEndBeyondLabLimit,
  isPeriodDurationTooShort,
  isPeriodInPast,
  isPeriodRangeOrderInvalid,
} from "@/utils/allocationPeriodValidation";

const allocationsStore = useAllocationsStore();
const machinesStore = useMachinesStore();
const auth = useAuthStore();
const lab = useLabConfigStore();
const notifications = useNotificationsStore();
const usersStore = useUsersStore();
const route = useRoute();
const router = useRouter();

const showForm = ref(false);
const panelAlign = ref({ top: 0, height: 0 });

const ganttAllocations = ref<Allocation[]>([]);
const ganttLoading = ref(false);

const MACHINE_STATUS_LABELS: Record<Machine["status"], string> = {
  available: "Disponível",
  occupied: "Ocupada",
  offline: "Inativa",
  maintenance: "Manutenção",
  disabled: "Desabilitada",
};

const isAdmin = computed(() => auth.user?.role === "admin");

const requiresAdminApproval = computed(
  () => lab.config.allocation.requireAdminApproval === true,
);

// Usuário comum com aprovação obrigatória apenas solicita a reserva (nasce pendente).
const isRequestMode = computed(
  () => !isAdmin.value && requiresAdminApproval.value,
);

const panelAlignStyle = computed(() => {
  if (!showForm.value || panelAlign.value.height <= 0) return undefined;
  return {
    marginTop: `${panelAlign.value.top}px`,
    height: `${panelAlign.value.height}px`,
  };
});

const selectedMachine = computed(() =>
  machinesStore.machines.find((m) => m.id === Number(form.value.machineId)),
);

const periodFilled = computed(
  () =>
    !!form.value.startDate &&
    !!form.value.startTime &&
    !!form.value.endDate &&
    !!form.value.endTime,
);

const periodFields = computed(() => ({
  startDate: form.value.startDate,
  startTime: form.value.startTime,
  endDate: form.value.endDate,
  endTime: form.value.endTime,
}));

const periodRangeInvalid = computed(
  () =>
    periodFilled.value &&
    isPeriodRangeOrderInvalid(periodFields.value, lab.timezone),
);

const periodInPast = computed(
  () =>
    periodFilled.value &&
    isPeriodInPast(periodFields.value, lab.timezone, serverNowMs()),
);

const periodEndTooFar = computed(() => {
  if (!periodFilled.value || periodRangeInvalid.value || periodInPast.value)
    return false;
  try {
    return isAllocationEndBeyondLabLimit(
      form.value.endDate,
      form.value.endTime,
      lab.timezone,
      lab.config.allocation.maxFutureDays,
      lab.todayIso,
    );
  } catch {
    return false;
  }
});

const periodTooShort = computed(() => {
  if (
    !periodFilled.value ||
    periodRangeInvalid.value ||
    periodInPast.value
  )
    return false;
  return isPeriodDurationTooShort(
    periodFields.value,
    lab.timezone,
    lab.config.allocation.minDurationMinutes,
  );
});

const periodErrorMessage = computed((): string | null => {
  if (periodInPast.value) return PERIOD_IN_PAST_MESSAGE;
  if (periodRangeInvalid.value) return PERIOD_INVALID_RANGE_MESSAGE;
  if (periodTooShort.value) {
    return periodTooShortMessage(lab.config.allocation.minDurationMinutes);
  }
  if (periodEndTooFar.value) return PERIOD_END_TOO_FAR_MESSAGE;
  return null;
});

const formRangeIso = computed((): { start: string; end: string } | null => {
  if (!periodFilled.value || periodErrorMessage.value) return null;
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

const periodAvailable = computed(() => {
  if (!selectedMachine.value || !formRangeIso.value) return null;
  return isMachineAvailableForPeriod(
    selectedMachine.value,
    ganttAllocations.value,
    formRangeIso.value.start,
    formRangeIso.value.end,
  );
});

const canCreateReservation = computed(() => {
  if (
    formSaving.value ||
    !form.value.machineId ||
    !periodFilled.value ||
    !formRangeIso.value
  ) {
    return false;
  }
  return periodAvailable.value === true;
});

async function loadGanttAllocations() {
  ganttLoading.value = true;
  try {
    if (machinesStore.machines.length > 0) {
      const promises = machinesStore.machines.map((m) =>
        machinesStore.fetchMachineAllocations(m.id, { limit: 500 }),
      );
      const results = await Promise.all(promises);
      ganttAllocations.value = results.flatMap((r) => r.data || []);
    }
  } finally {
    ganttLoading.value = false;
  }
}

const focusMachineId = computed((): number | null => {
  const raw = route.query.machine ?? route.query.machineId;
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
});

function emptyReservationForm(machineId: string | number = "") {
  return {
    machineId,
    targetUserId: "" as number | "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    reason: "",
    homeMountpoint: "",
  };
}

function openForm(machineId?: number) {
  form.value = emptyReservationForm(machineId ?? "");
  formError.value = "";
  showForm.value = true;
}

async function applyReservationFromRoute() {
  const wantsReserve =
    route.query.reserve === "1" || route.query.reserve === "true";
  if (!wantsReserve || focusMachineId.value == null) return;

  if (!machinesStore.machines.length) {
    await machinesStore.fetchMachines();
  }
  const exists = machinesStore.machines.some(
    (m) => m.id === focusMachineId.value,
  );
  if (!exists) return;

  openForm(focusMachineId.value);
  await loadGanttAllocations();

  const nextQuery = { ...route.query };
  delete nextQuery.reserve;
  await router.replace({ name: "home", query: nextQuery });
}

onMounted(async () => {
  await machinesStore.fetchMachines();
  if (auth.user?.role === "admin") {
    await usersStore.fetchUsers();
  }
  await loadGanttAllocations();
  await applyReservationFromRoute();
});

watch(
  () => [route.query.machine, route.query.machineId, route.query.reserve] as const,
  () => {
    void applyReservationFromRoute();
  },
);

const form = ref(emptyReservationForm());
const formSaving = ref(false);
const formError = ref("");

async function handleCreate() {
  formError.value = "";

  if (!canCreateReservation.value) {
    if (!form.value.machineId || !periodFilled.value) {
      formError.value = "Preencha todos os campos obrigatórios.";
    } else if (periodErrorMessage.value) {
      formError.value = periodErrorMessage.value;
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
      machineId: Number(form.value.machineId),
      startTime,
      endTime,
      reason: form.value.reason.trim().slice(0, ALLOCATION_REASON_MAX_LENGTH) || undefined,
      homeMountpoint: form.value.homeMountpoint.trim() || undefined,
      userId: isAdmin.value && form.value.targetUserId
        ? Number(form.value.targetUserId)
        : undefined,
    });
    showForm.value = false;
    await Promise.all([loadGanttAllocations(), notifications.fetchNotifications()]);
  } catch (err: unknown) {
    formError.value = allocationApiErrorMessage(err, "Erro ao criar reserva.");
  } finally {
    formSaving.value = false;
  }
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Reservas</h1>
      <button v-if="!showForm" class="btn btn-primary" @click="openForm()">
        {{ isRequestMode ? "+ Solicitar Reserva" : "+ Nova Reserva" }}
      </button>
    </div>

    <div class="layout-row" :class="{ 'with-panel': showForm }">
      <section class="layout-calendar">
        <CalendarGanttScroll
          :machines="machinesStore.machines"
          :allocations="ganttAllocations"
          :current-user-id="auth.user?.id ?? null"
          :loading="ganttLoading || lab.loading"
          :scroll-to-machine-id="focusMachineId"
          @panel-align="(m) => (panelAlign = m)"
        />
      </section>

      <aside
        v-if="showForm"
        class="layout-panel fade-in"
        :style="panelAlignStyle"
      >
        <div class="panel-card">
          <div class="panel-header">
            <h2 class="panel-title">
              {{ isRequestMode ? "Solicitar Reserva" : "Nova Reserva" }}
            </h2>
            <button type="button" class="btn-close" @click="showForm = false">
              ✕
            </button>
          </div>

          <form class="panel-body" @submit.prevent="handleCreate">
            <ReservationFormFields
              v-model:machine-id="form.machineId"
              v-model:target-user-id="form.targetUserId"
              v-model:start-date="form.startDate"
              v-model:start-time="form.startTime"
              v-model:end-date="form.endDate"
              v-model:end-time="form.endTime"
              v-model:reason="form.reason"
              v-model:home-mountpoint="form.homeMountpoint"
              :is-admin="isAdmin"
              :users="usersStore.users"
              show-machine-picker
              :machines="machinesStore.machines"
              :status-labels="MACHINE_STATUS_LABELS"
              :period-ready="!!formRangeIso"
              :period-error-message="periodErrorMessage"
              :period-available="
                formRangeIso && selectedMachine ? periodAvailable : null
              "
            />

            <p v-if="formError" class="error-text">{{ formError }}</p>

            <div class="panel-actions">
              <button type="button" class="btn btn-ghost" @click="showForm = false">
                Cancelar
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="!canCreateReservation"
              >
                <template v-if="isRequestMode">
                  {{ formSaving ? "Solicitando..." : "Solicitar Reserva" }}
                </template>
                <template v-else>
                  {{ formSaving ? "Criando..." : "Criar Reserva" }}
                </template>
              </button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.layout-row {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
  justify-content: center;
}

.layout-calendar {
  flex: 1;
  min-width: 0;
  transition: all 0.3s ease;
}

.layout-row.with-panel .layout-calendar {
  flex: 1 1 0;
}

.layout-panel {
  width: 360px;
  flex-shrink: 0;
}

.panel-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 0.9rem 1.15rem;
  border-bottom: 1px solid var(--border-subtle);
}

.panel-title {
  font-size: 1.05rem;
  font-weight: 600;
}

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 1rem 1.15rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow: hidden;
}

.panel-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.65rem;
  margin-top: auto;
  padding-top: 0.35rem;
  flex-shrink: 0;
}

.panel-actions .btn {
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  min-height: 2.35rem;
}

.panel-actions .btn-primary {
  padding-left: 1.15rem;
  padding-right: 1.15rem;
}

.error-text {
  margin: 0;
  font-size: 0.88rem;
}

@media (max-width: 900px) {
  .layout-row,
  .layout-row.with-panel {
    flex-direction: column;
  }

  .layout-panel {
    width: 100%;
    height: auto !important;
    margin-top: 0 !important;
  }

  .panel-card {
    height: auto;
  }
}
</style>
