<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import CalendarGanttScroll from "@/components/CalendarGanttScroll.vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import { useAuthStore } from "@/stores/auth";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation, Machine } from "@/types";
import {
  utcIsoToWallClockFields,
  wallClockToUtcIso,
  formatLabDateTime,
  normalizeApiUtcIso,
} from "@/utils/datetime";
import { effectiveLifecycleStatus } from "@/utils/allocationLifecycle";
import LabWallClockDateInput from "@/components/LabWallClockDateInput.vue";
import LabWallClockTimeInput from "@/components/LabWallClockTimeInput.vue";
import { machineHasAllocationConflict } from "@/utils/allocationAvailability";
import {
  EXTEND_END_NOT_AFTER_CURRENT_MESSAGE,
  PERIOD_ALLOCATION_CONFLICT_MESSAGE,
  PERIOD_END_TOO_FAR_MESSAGE,
  PERIOD_INVALID_RANGE_MESSAGE,
  periodTooShortMessage,
} from "@/utils/allocationLabels";
import {
  isAllocationEndBeyondLabLimit,
  isExtendEndBeforeCurrent,
  isExtendEndNotAfterCurrent,
  isPeriodDurationTooShort,
  isPeriodRangeOrderInvalid,
} from "@/utils/allocationPeriodValidation";

const props = withDefaults(
  defineProps<{ allocation: Allocation; adminMode?: boolean }>(),
  { adminMode: false },
);
const emit = defineEmits<{ close: []; extended: [allocation: Allocation] }>();

const store = useAllocationsStore();
const machinesStore = useMachinesStore();
const auth = useAuthStore();
const lab = useLabConfigStore();

const ganttAllocations = ref<Allocation[]>([]);
const ganttLoading = ref(true);
const saving = ref(false);
const formError = ref("");

const form = ref({
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
});

function syncFormFromAllocation() {
  const tz = lab.timezone;
  const start = utcIsoToWallClockFields(props.allocation.startTime, tz);
  const end = utcIsoToWallClockFields(props.allocation.endTime, tz);
  form.value = {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

const lifecycle = computed(() =>
  effectiveLifecycleStatus(props.allocation, lab.allocationAccess),
);

/** Admin: início editável só antes da sessão (pending ou approved, não active/grace). */
const canEditStart = computed(() => {
  if (!props.adminMode) return false;
  if (props.allocation.status === "pending") return true;
  if (props.allocation.status === "approved") {
    return lifecycle.value === "approved";
  }
  return false;
});

const overlayTitle = computed(() =>
  props.adminMode ? "Editar alocação" : "Estender alocação",
);

const hintText = computed(() => {
  if (props.adminMode) {
    return canEditStart.value
      ? "Altere início e fim da reserva."
      : "Só a finalização pode ser alterada (sessão já iniciada).";
  }
  return "Só a finalização pode ser alterada.";
});

const submitLabel = computed(() => {
  if (saving.value) return "Salvando…";
  return props.adminMode ? "Salvar alterações" : "Confirmar extensão";
});

const machine = computed<Machine | undefined>(() => {
  if (props.allocation.machine) return props.allocation.machine;
  return machinesStore.machines.find((m) => m.id === props.allocation.machineId);
});

const calendarMachines = computed(() => {
  const m = machine.value;
  return m ? [m] : [];
});

const machineLabel = computed(
  () => machine.value?.name ?? `Máquina #${props.allocation.machineId}`,
);

const machineDescription = computed(() => {
  const t = machine.value?.description?.trim();
  if (!t) return null;
  return t.replace(/\s*\(semanas\)\s*$/i, "").trim() || t;
});

const calendarScrollIso = computed(() => {
  if (!lab.timezone) return null;
  try {
    return utcIsoToWallClockFields(props.allocation.endTime, lab.timezone).date;
  } catch {
    return null;
  }
});

const effectiveStartFields = computed(() => {
  if (canEditStart.value) {
    return {
      startDate: form.value.startDate,
      startTime: form.value.startTime,
    };
  }
  const start = utcIsoToWallClockFields(props.allocation.startTime, lab.timezone);
  return { startDate: start.date, startTime: start.time };
});

const periodFilled = computed(() => {
  if (props.adminMode && canEditStart.value) {
    return (
      !!form.value.startDate &&
      !!form.value.startTime &&
      !!form.value.endDate &&
      !!form.value.endTime
    );
  }
  return !!form.value.endDate && !!form.value.endTime;
});

const periodFields = computed(() => ({
  startDate: effectiveStartFields.value.startDate,
  startTime: effectiveStartFields.value.startTime,
  endDate: form.value.endDate,
  endTime: form.value.endTime,
}));

const periodRangeInvalid = computed(
  () =>
    periodFilled.value &&
    isPeriodRangeOrderInvalid(periodFields.value, lab.timezone),
);

const periodTooShort = computed(() => {
  if (!periodFilled.value || periodRangeInvalid.value) return false;
  return isPeriodDurationTooShort(
    periodFields.value,
    lab.timezone,
    lab.config.allocation.minDurationMinutes,
  );
});

const periodEndTooFar = computed(() => {
  if (!periodFilled.value || periodRangeInvalid.value) return false;
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

const extendEndBeforeCurrent = computed(() => {
  if (props.adminMode || !periodFilled.value) return false;
  return isExtendEndBeforeCurrent(
    form.value.endDate,
    form.value.endTime,
    lab.timezone,
    props.allocation.endTime,
  );
});

const extendEndNotAfterCurrent = computed(() => {
  if (props.adminMode || !periodFilled.value) return false;
  return isExtendEndNotAfterCurrent(
    form.value.endDate,
    form.value.endTime,
    lab.timezone,
    props.allocation.endTime,
  );
});

const adminFormRangeIso = computed((): { start: string; end: string } | null => {
  if (!props.adminMode || !periodFilled.value || periodRangeInvalid.value) return null;
  try {
    const start = wallClockToUtcIso(
      effectiveStartFields.value.startDate,
      effectiveStartFields.value.startTime,
      lab.timezone,
    );
    const end = wallClockToUtcIso(
      form.value.endDate,
      form.value.endTime,
      lab.timezone,
    );
    if (end <= start) return null;
    return {
      start: normalizeApiUtcIso(start),
      end: normalizeApiUtcIso(end),
    };
  } catch {
    return null;
  }
});

/** Conflito com outra reserva (exclui a alocação em edição). */
const periodHasConflict = computed(() => {
  if (!props.adminMode || !adminFormRangeIso.value) return false;
  return machineHasAllocationConflict(
    ganttAllocations.value,
    props.allocation.machineId,
    adminFormRangeIso.value.start,
    adminFormRangeIso.value.end,
    props.allocation.id,
  );
});

/** Borda vermelha sem texto — igual à criação; igual ao fim atual não conta como erro. */
const periodHasError = computed(() => {
  if (!periodFilled.value) return false;
  if (props.adminMode) {
    return (
      periodRangeInvalid.value ||
      periodTooShort.value ||
      periodEndTooFar.value ||
      periodHasConflict.value
    );
  }
  return extendEndBeforeCurrent.value || periodEndTooFar.value;
});

/** Mensagens só no envio do formulário. */
const periodErrorMessage = computed((): string | null => {
  if (!periodFilled.value) return null;
  if (props.adminMode) {
    if (periodRangeInvalid.value) return PERIOD_INVALID_RANGE_MESSAGE;
    if (periodTooShort.value) {
      return periodTooShortMessage(lab.config.allocation.minDurationMinutes);
    }
    if (periodEndTooFar.value) return PERIOD_END_TOO_FAR_MESSAGE;
    if (periodHasConflict.value) return PERIOD_ALLOCATION_CONFLICT_MESSAGE;
    return null;
  }
  if (extendEndNotAfterCurrent.value) return EXTEND_END_NOT_AFTER_CURRENT_MESSAGE;
  if (periodEndTooFar.value) return PERIOD_END_TOO_FAR_MESSAGE;
  return null;
});

onMounted(async () => {
  try {
    if (!lab.loaded) await lab.fetchConfig();
    syncFormFromAllocation();
    if (!machinesStore.machines.length) {
      await machinesStore.fetchMachines();
    }
    const res = await machinesStore.fetchMachineAllocations(
      props.allocation.machineId,
      { limit: 500 },
    );
    ganttAllocations.value = res.data ?? [];
  } finally {
    ganttLoading.value = false;
  }
});

function apiErrorMessage(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } })
    ?.response;
  const data = res?.data;
  if (!data) return "Erro ao salvar alterações.";

  if (typeof data.message === "string" && data.message) return data.message;

  const errors = data.errors;
  if (Array.isArray(errors)) {
    const msgs = errors
      .map((e) =>
        typeof e === "string"
          ? e
          : typeof (e as { message?: string })?.message === "string"
            ? (e as { message: string }).message
            : null,
      )
      .filter(Boolean);
    if (msgs.length) return msgs.join(" ");
  }

  return "Erro ao salvar alterações.";
}

async function handleAdminSave() {
  formError.value = "";
  if (!periodFilled.value) {
    formError.value = "Preencha data e horário de início e fim.";
    return;
  }
  if (periodErrorMessage.value) {
    formError.value = periodErrorMessage.value;
    return;
  }

  let startTime: string;
  let endTime: string;
  try {
    startTime = normalizeApiUtcIso(
      wallClockToUtcIso(form.value.startDate, form.value.startTime, lab.timezone),
    );
    endTime = normalizeApiUtcIso(
      wallClockToUtcIso(form.value.endDate, form.value.endTime, lab.timezone),
    );
  } catch {
    formError.value = "Data ou horário inválido.";
    return;
  }

  saving.value = true;
  try {
    const payload: Record<string, string> = { endTime };
    if (canEditStart.value) {
      payload.startTime = startTime;
    }
    const updated = await store.updateAllocation(props.allocation.id, payload);
    emit("extended", updated);
    emit("close");
  } catch (err: unknown) {
    const res = (err as { response?: { status?: number; data?: { code?: string } } })
      ?.response;
    const status = res?.status;
    const code = res?.data?.code;
    if (status === 409 || code === "ALLOCATION_CONFLICT") {
      formError.value =
        "Conflito com outra reserva nesta máquina. Ajuste o intervalo.";
    } else formError.value = apiErrorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function handleExtend() {
  formError.value = "";
  if (!periodFilled.value) {
    formError.value = "Informe a nova data e horário de finalização.";
    return;
  }
  if (periodErrorMessage.value) {
    formError.value = periodErrorMessage.value;
    return;
  }

  let endTime: string;
  try {
    endTime = normalizeApiUtcIso(
      wallClockToUtcIso(form.value.endDate, form.value.endTime, lab.timezone),
    );
  } catch {
    formError.value = "Data ou horário de finalização inválido.";
    return;
  }

  saving.value = true;
  try {
    const updated = await store.extendAllocation(props.allocation.id, {
      endTime,
    });
    emit("extended", updated);
    emit("close");
  } catch (err: unknown) {
    const res = (err as { response?: { status?: number; data?: { code?: string } } })
      ?.response;
    const status = res?.status;
    const code = res?.data?.code;
    if (status === 409 || code === "ALLOCATION_CONFLICT")
      formError.value =
        "Conflito com outra reserva nesta máquina. Escolha um horário de fim anterior à próxima alocação.";
    else formError.value = apiErrorMessage(err);
  } finally {
    saving.value = false;
  }
}

function handleSubmit() {
  if (props.adminMode) {
    void handleAdminSave();
  } else {
    void handleExtend();
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="extend-overlay" @click.self="emit('close')">
      <div class="extend-shell fade-in">
        <div class="extend-layout">
          <div class="layout-main">
            <header class="extend-head">
              <h2 class="extend-head-title">{{ overlayTitle }}</h2>
              <p class="extend-head-machine">{{ machineLabel }}</p>
              <p v-if="machineDescription" class="extend-head-desc text-secondary">
                {{ machineDescription }}
              </p>
              <p class="extend-head-hint text-muted">
                {{ hintText }}
              </p>
            </header>

            <section class="layout-calendar">
              <CalendarGanttScroll
                :machines="calendarMachines"
                :allocations="ganttAllocations"
                :current-user-id="auth.user?.id ?? null"
                :loading="ganttLoading || lab.loading"
                compact
                single-machine-focus
                :highlight-allocation-id="allocation.id"
                :initial-scroll-iso="calendarScrollIso"
              />
            </section>
          </div>

          <aside class="layout-panel">
            <div class="panel-card">
              <form class="panel-body" @submit.prevent="handleSubmit">
                <div class="panel-machine-row">
                  <span class="field-label field-label--section">Máquina</span>
                  <button
                    type="button"
                    class="btn-close"
                    aria-label="Fechar"
                    @click="emit('close')"
                  >
                    ✕
                  </button>
                </div>

                <div class="field-group">
                  <label class="field-label field-label--section">Início</label>
                  <div
                    class="field-row"
                    :class="{ 'field-row--error': periodHasError && canEditStart }"
                  >
                    <div class="field">
                      <label class="field-label field-label--small">Data</label>
                      <LabWallClockDateInput
                        v-model="form.startDate"
                        :disabled="!canEditStart"
                        :invalid="periodHasError && canEditStart"
                        aria-label="Data de início"
                      />
                    </div>
                    <div class="field">
                      <label class="field-label field-label--small">Horário</label>
                      <LabWallClockTimeInput
                        v-model="form.startTime"
                        :disabled="!canEditStart"
                        :invalid="periodHasError && canEditStart"
                        aria-label="Horário de início"
                      />
                    </div>
                  </div>
                </div>

                <div class="field-group">
                  <label class="field-label field-label--section"
                    >Finalização</label
                  >
                  <div class="field-row" :class="{ 'field-row--error': periodHasError }">
                    <div class="field">
                      <label class="field-label field-label--small">Data</label>
                      <LabWallClockDateInput
                        v-model="form.endDate"
                        :invalid="periodHasError"
                        aria-label="Data de finalização"
                      />
                    </div>
                    <div class="field">
                      <label class="field-label field-label--small">Horário</label>
                      <LabWallClockTimeInput
                        v-model="form.endTime"
                        :invalid="periodHasError"
                        aria-label="Horário de finalização"
                      />
                    </div>
                  </div>
                  <p class="field-hint text-muted">
                    Fim atual:
                    {{ formatLabDateTime(allocation.endTime, lab.timezone) }}
                  </p>
                </div>

                <p v-if="formError" class="error-text">{{ formError }}</p>

                <div class="panel-actions">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    @click="emit('close')"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    class="btn btn-primary"
                    :disabled="saving"
                  >
                    {{ submitLabel }}
                  </button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.extend-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  overflow-y: auto;
}

.extend-shell {
  width: 100%;
  max-width: 1280px;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated);
  padding: 1rem 1.25rem 1.25rem;
}

.extend-layout {
  display: flex;
  gap: 1rem;
  align-items: stretch;
}

.layout-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  justify-content: flex-start;
}

.extend-head {
  padding: 0.15rem 0.25rem 0;
}

.extend-head-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.25;
}

.extend-head-machine {
  margin: 0.35rem 0 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
}

.extend-head-desc {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
  line-height: 1.4;
}

.extend-head-hint {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  line-height: 1.35;
}

.layout-calendar {
  min-width: 0;
  width: 100%;
  margin-top: auto;
}

.layout-calendar :deep(.gantt-wrap) {
  width: 100%;
}

.layout-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.panel-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.panel-machine-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: -0.15rem;
}

.panel-machine-row .field-label {
  margin: 0;
}

.panel-body {
  padding: 0.75rem 0.9rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.panel-actions {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--border-subtle);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-row {
  display: flex;
  gap: 0.5rem;
}

.field-row .field {
  flex: 1;
  min-width: 0;
}

.field-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-label--section {
  font-weight: 600;
  color: var(--text-primary);
}

.field-label--small {
  font-size: 0.7rem;
}

.field-hint {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
}

input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.error-text {
  color: var(--danger);
  font-size: 0.82rem;
  margin: 0;
}

@media (max-width: 960px) {
  .extend-layout {
    flex-direction: column;
    align-items: stretch;
  }

  .layout-panel {
    width: 100%;
  }

  .layout-calendar {
    margin-top: 0;
  }

  .extend-head {
    padding-bottom: 0.25rem;
  }
}
</style>
