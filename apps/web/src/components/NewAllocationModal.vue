<script setup lang="ts">
import { ref, reactive } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useAuthStore } from "@/stores/auth";
import { useNotificationsStore } from "@/stores/notifications";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Machine } from "@/types";
import { wallClockToUtcIso } from "@/utils/datetime";
import { ALLOCATION_REASON_MAX_LENGTH } from "@/utils/allocationLabels";

const props = defineProps<{ machines: Machine[] }>();
const emit = defineEmits<{ close: []; created: [] }>();

const allocations = useAllocationsStore();
const auth = useAuthStore();
const notifications = useNotificationsStore();
const lab = useLabConfigStore();

const form = reactive({
  machineId: "" as string | number,
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  reason: "",
  isSudo: false,
});

const saving = ref(false);
const error = ref("");

async function handleCreate() {
  error.value = "";

  if (
    !form.machineId ||
    !form.startDate ||
    !form.startTime ||
    !form.endDate ||
    !form.endTime
  ) {
    error.value = "Preencha todos os campos obrigatórios.";
    return;
  }

  let startTime: string;
  let endTime: string;
  try {
    startTime = wallClockToUtcIso(form.startDate, form.startTime, lab.timezone);
    endTime = wallClockToUtcIso(form.endDate, form.endTime, lab.timezone);
  } catch {
    error.value = "Data ou horário inválido.";
    return;
  }

  if (endTime <= startTime) {
    error.value = "Data/horário de finalização deve ser após o início.";
    return;
  }

  saving.value = true;
  try {
    await allocations.createAllocation({
      machineId: Number(form.machineId),
      startTime,
      endTime,
      reason:
        form.reason.trim().slice(0, ALLOCATION_REASON_MAX_LENGTH) || undefined,
      isSudo: auth.isAdmin ? undefined : form.isSudo,
    });
    await notifications.fetchNotifications();
    emit("created");
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 409) error.value = "Conflito de horário com outra reserva.";
    else if (status === 422)
      error.value = "Dados inválidos. Verifique os campos.";
    else error.value = "Erro ao criar reserva.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-glass fade-in">
        <div class="modal-header">
          <h2 class="modal-title">Nova Reserva</h2>
          <button class="btn-close" @click="emit('close')">✕</button>
        </div>

        <form class="modal-body" @submit.prevent="handleCreate">
          <div class="field">
            <label class="field-label">Máquina</label>
            <select v-model="form.machineId">
              <option value="" disabled>Selecione...</option>
              <option
                v-for="m in props.machines.filter(
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
            <label class="field-label field-group-title">Início</label>
            <div class="field-row">
              <div class="field">
                <label class="field-label field-sublabel">Data</label>
                <input v-model="form.startDate" type="date" />
              </div>
              <div class="field">
                <label class="field-label field-sublabel">Horário</label>
                <input v-model="form.startTime" type="time" />
              </div>
            </div>
          </div>

          <div class="field-group">
            <label class="field-label field-group-title">Finalização</label>
            <div class="field-row">
              <div class="field">
                <label class="field-label field-sublabel">Data</label>
                <input v-model="form.endDate" type="date" />
              </div>
              <div class="field">
                <label class="field-label field-sublabel">Horário</label>
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

          <p v-if="error" class="error-text">{{ error }}</p>

          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" @click="emit('close')">
              Cancelar
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? "Criando..." : "Criar Reserva" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.modal-glass {
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated);
  width: 100%;
  max-width: 460px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}
.modal-title {
  font-size: 1.1rem;
  font-weight: 600;
}

.modal-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field-group-title {
  font-weight: 600;
  margin-bottom: 0.35rem;
  display: block;
}

.field-sublabel {
  font-size: 0.75rem;
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

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}
</style>
