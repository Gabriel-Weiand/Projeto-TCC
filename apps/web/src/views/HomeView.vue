<script setup lang="ts">
import CalendarGanttScroll from "@/components/CalendarGanttScroll.vue";
import { ref, onMounted } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import { useAuthStore } from "@/stores/auth";
import { useLabConfigStore } from "@/stores/labConfig";
import { useNotificationsStore } from "@/stores/notifications";
import type { Allocation } from "@/types";
import { wallClockToUtcIso } from "@/utils/datetime";
import { ALLOCATION_REASON_MAX_LENGTH } from "@/utils/allocationLabels";

const allocationsStore = useAllocationsStore();
const machinesStore = useMachinesStore();
const auth = useAuthStore();
const lab = useLabConfigStore();
const notifications = useNotificationsStore();

const showForm = ref(false);

/* ---- Calendar allocations for Gantt ---- */
const ganttAllocations = ref<Allocation[]>([]);
const ganttLoading = ref(false);

// Calculo da margem vinda do topo para alinhar o painel lateral com a linha do tempo do Gantt
const panelMarginTop = ref(0);

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

onMounted(async () => {
  await machinesStore.fetchMachines();
  await loadGanttAllocations();
});

/* ---- Inline form (Multi-day allocations) ---- */
// NOVO: Separamos data e horário tanto para início quanto para fim
const form = ref({
  machineId: "" as string | number,
  startDate: "", // Data de início (ex: 2026-05-12)
  startTime: "", // Hora de início (ex: 09:00)
  endDate: "", // Data de finalização (ex: 2026-05-14)
  endTime: "", // Hora de finalização (ex: 17:00)
  reason: "",
  isSudo: false,
});
const formSaving = ref(false);
const formError = ref("");

function openForm() {
  form.value = {
    machineId: "",
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

async function handleCreate() {
  formError.value = "";

  // Verificar se todos os campos obrigatórios foram preenchidos
  if (
    !form.value.machineId ||
    !form.value.startDate ||
    !form.value.startTime ||
    !form.value.endDate ||
    !form.value.endTime
  ) {
    formError.value = "Preencha todos os campos obrigatórios.";
    return;
  }

  let startTime: string;
  let endTime: string;
  try {
    startTime = wallClockToUtcIso(
      form.value.startDate,
      form.value.startTime,
      lab.timezone,
    );
    endTime = wallClockToUtcIso(
      form.value.endDate,
      form.value.endTime,
      lab.timezone,
    );
  } catch {
    formError.value = "Data ou horário inválido.";
    return;
  }

  if (endTime <= startTime) {
    formError.value = "Data/horário de finalização deve ser após o início.";
    return;
  }

  formSaving.value = true;
  try {
    await allocationsStore.createAllocation({
      machineId: Number(form.value.machineId),
      startTime,
      endTime,
      reason: form.value.reason.trim().slice(0, ALLOCATION_REASON_MAX_LENGTH) || undefined,
      isSudo: auth.isAdmin ? undefined : form.value.isSudo,
    });
    showForm.value = false;
    await Promise.all([loadGanttAllocations(), notifications.fetchNotifications()]);
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 409)
      formError.value = "Conflito de horário com outra reserva.";
    else if (status === 422)
      formError.value = "Dados inválidos. Verifique os campos.";
    else formError.value = "Erro ao criar reserva.";
  } finally {
    formSaving.value = false;
  }
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Reservas</h1>
      <button v-if="!showForm" class="btn btn-primary" @click="openForm">
        + Nova Reserva
      </button>
    </div>

    <!-- ======== Calendar Gantt + Form Row ======== -->
    <div class="layout-row" :class="{ 'with-panel': showForm }">
      <section class="layout-calendar">
        <CalendarGanttScroll
          :machines="machinesStore.machines"
          :allocations="ganttAllocations"
          :current-user-id="auth.user?.id ?? null"
          :loading="ganttLoading || lab.loading"
          @offset-calculated="(val) => (panelMarginTop = val)"
        />
      </section>

      <aside
        v-if="showForm"
        class="layout-panel fade-in"
        :style="{ marginTop: panelMarginTop + 'px' }"
      >
        <div class="panel-card">
          <div class="panel-header">
            <h2 class="panel-title">Nova Reserva</h2>
            <button class="btn-close" @click="showForm = false">✕</button>
          </div>
          <form class="panel-body" @submit.prevent="handleCreate">
            <div class="field">
              <label class="field-label">Máquina</label>
              <select v-model="form.machineId">
                <option value="" disabled>Selecione...</option>
                <option
                  v-for="m in machinesStore.machines.filter(
                    (m) => m.status !== 'maintenance',
                  )"
                  :key="m.id"
                  :value="m.id"
                >
                  {{ m.name }} —
                  {{
                    m.status === "available"
                      ? "🟢 Disponível"
                      : m.status === "occupied"
                        ? "🟡 Ocupada"
                        : "🔴 Offline"
                  }}
                </option>
              </select>
            </div>

            <div class="field-group">
              <label
                class="field-label"
                style="font-weight: 600; margin-bottom: 0.5rem; display: block"
              >
                📅 Início
              </label>
              <div class="field-row">
                <div class="field">
                  <label class="field-label" style="font-size: 0.75rem"
                    >Data</label
                  >
                  <input v-model="form.startDate" type="date" />
                </div>
                <div class="field">
                  <label class="field-label" style="font-size: 0.75rem"
                    >Horário</label
                  >
                  <input v-model="form.startTime" type="time" />
                </div>
              </div>
            </div>

            <div class="field-group">
              <label
                class="field-label"
                style="font-weight: 600; margin-bottom: 0.5rem; display: block"
              >
                📅 Finalização
              </label>
              <div class="field-row">
                <div class="field">
                  <label class="field-label" style="font-size: 0.75rem"
                    >Data</label
                  >
                  <input v-model="form.endDate" type="date" />
                </div>
                <div class="field">
                  <label class="field-label" style="font-size: 0.75rem"
                    >Horário</label
                  >
                  <input v-model="form.endTime" type="time" />
                </div>
              </div>
            </div>

            <label v-if="!auth.isAdmin" class="sudo-toggle">
              <input v-model="form.isSudo" type="checkbox" />
              <span>
                Solicitar privilégios <strong>sudo</strong> na máquina
                <span class="text-muted">(requer aprovação do admin)</span>
              </span>
            </label>

            <div class="field">
              <label class="field-label"
                >Motivo
                <span class="text-muted"
                  >(opcional, máx. {{ ALLOCATION_REASON_MAX_LENGTH }})</span
                ></label
              >
              <textarea
                v-model="form.reason"
                class="field-textarea"
                rows="3"
                :maxlength="ALLOCATION_REASON_MAX_LENGTH"
                placeholder="Ex: Treinamento de modelo ML"
              ></textarea>
              <span class="field-hint text-muted"
                >{{ form.reason.length }}/{{ ALLOCATION_REASON_MAX_LENGTH }}</span
              >
            </div>
            <p v-if="formError" class="error-text">{{ formError }}</p>
            <div class="panel-actions">
              <button
                type="button"
                class="btn btn-ghost"
                @click="showForm = false"
              >
                Cancelar
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="formSaving"
              >
                {{ formSaving ? "Criando..." : "Criar Reserva" }}
              </button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* ---- Side-by-side layout ---- */
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
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  position: sticky;
  top: 80px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}
.panel-title {
  font-size: 1.05rem;
  font-weight: 600;
}
.panel-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.sudo-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.88rem;
  line-height: 1.4;
  cursor: pointer;
}

.sudo-toggle input {
  margin-top: 0.2rem;
}
.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

@media (max-width: 900px) {
  .layout-row {
    flex-direction: column;
  }
  .layout-panel {
    width: 100%;
  }
}
</style>
