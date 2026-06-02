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
  parseApiUtcMs,
  normalizeApiUtcIso,
} from "@/utils/datetime";

const props = defineProps<{ allocation: Allocation }>();
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

/** Dia civil de fim da reserva (TZ do lab) — scroll inicial do Gantt. */
const calendarScrollIso = computed(() => {
  if (!lab.timezone) return null;
  try {
    return utcIsoToWallClockFields(props.allocation.endTime, lab.timezone).date;
  } catch {
    return null;
  }
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
  if (!data) return "Erro ao estender reserva.";

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

  return "Erro ao estender reserva.";
}

async function handleExtend() {
  formError.value = "";
  if (!form.value.endDate || !form.value.endTime) {
    formError.value = "Informe a nova data e horário de finalização.";
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

  const currentEndMs = parseApiUtcMs(props.allocation.endTime);
  const newEndMs = parseApiUtcMs(endTime);
  if (newEndMs <= currentEndMs) {
    formError.value =
      "A finalização deve ser posterior ao fim atual da reserva.";
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
</script>

<template>
  <Teleport to="body">
    <div class="extend-overlay" @click.self="emit('close')">
      <div class="extend-shell fade-in">
        <div class="extend-layout">
          <div class="layout-main">
            <header class="extend-head">
              <h2 class="extend-head-title">Estender alocação</h2>
              <p class="extend-head-machine">{{ machineLabel }}</p>
              <p v-if="machineDescription" class="extend-head-desc text-secondary">
                {{ machineDescription }}
              </p>
              <p class="extend-head-hint text-muted">
                Só a finalização pode ser alterada.
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
              <form class="panel-body" @submit.prevent="handleExtend">
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
                  <div class="field-row">
                    <div class="field">
                      <label class="field-label field-label--small">Data</label>
                      <input
                        v-model="form.startDate"
                        type="date"
                        disabled
                        title="O início da alocação não pode ser alterado"
                      />
                    </div>
                    <div class="field">
                      <label class="field-label field-label--small">Horário</label>
                      <input
                        v-model="form.startTime"
                        type="time"
                        disabled
                        title="O início da alocação não pode ser alterado"
                      />
                    </div>
                  </div>
                </div>

                <div class="field-group">
                  <label class="field-label field-label--section"
                    >Finalização</label
                  >
                  <div class="field-row">
                    <div class="field">
                      <label class="field-label field-label--small">Data</label>
                      <input v-model="form.endDate" type="date" required />
                    </div>
                    <div class="field">
                      <label class="field-label field-label--small">Horário</label>
                      <input v-model="form.endTime" type="time" required />
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
                    {{ saving ? "Estendendo..." : "Confirmar extensão" }}
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
  align-items: flex-end;
}

.layout-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
}

.layout-calendar :deep(.gantt-wrap) {
  width: 100%;
}

.layout-panel {
  width: 320px;
  flex-shrink: 0;
  align-self: flex-end;
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

input[type="date"],
input[type="time"],
input[type="text"] {
  width: 100%;
  padding: 0.5rem 0.7rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.86rem;
}

@media (max-width: 960px) {
  .extend-layout {
    flex-direction: column;
  }

  .layout-panel {
    width: 100%;
  }

  .extend-head {
    padding-bottom: 0.25rem;
  }
}
</style>
