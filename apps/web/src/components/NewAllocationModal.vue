<script setup lang="ts">
import { ref } from "vue";
import type { Machine } from "@/types";
import { useAllocationsStore } from "@/stores/allocations";

const props = defineProps<{
  machines: Machine[];
  selectedDate: string;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
}>();

const allocStore = useAllocationsStore();

const machineId = ref<number | null>(null);
const startHour = ref("08:00");
const endHour = ref("10:00");
const reason = ref("");
const error = ref("");
const loading = ref(false);

// Apenas máquinas disponíveis
const availableMachines = props.machines.filter(
  (m) => m.status !== "maintenance",
);

async function handleCreate() {
  error.value = "";

  if (!machineId.value) {
    error.value = "Selecione uma máquina.";
    return;
  }

  const startTime = `${props.selectedDate}T${startHour.value}:00.000-03:00`;
  const endTime = `${props.selectedDate}T${endHour.value}:00.000-03:00`;

  if (startTime >= endTime) {
    error.value = "Horário final deve ser após o inicial.";
    return;
  }

  loading.value = true;
  try {
    await allocStore.createAllocation({
      machineId: machineId.value,
      startTime,
      endTime,
      reason: reason.value || undefined,
    });
    emit("created");
  } catch (err: any) {
    const data = err.response?.data;
    if (data?.code === "ALLOCATION_CONFLICT") {
      error.value =
        "Conflito: já existe uma reserva neste horário para esta máquina.";
    } else if (data?.code === "MACHINE_IN_MAINTENANCE") {
      error.value = "Máquina está em manutenção.";
    } else if (err.response?.status === 422) {
      const msgs = data?.errors?.map((e: any) => e.message).join(", ");
      error.value = msgs || "Dados inválidos.";
    } else {
      error.value = "Erro ao criar reserva.";
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h3>Nova Reserva</h3>
        <button class="btn-close" @click="emit('close')">✕</button>
      </div>

      <form @submit.prevent="handleCreate" class="modal-body">
        <label class="field">
          <span class="field-label">Máquina</span>
          <select v-model="machineId">
            <option :value="null" disabled>Selecione...</option>
            <option v-for="m in availableMachines" :key="m.id" :value="m.id">
              {{ m.name }} — {{ m.description }}
            </option>
          </select>
        </label>

        <div class="field-row">
          <label class="field">
            <span class="field-label">Início</span>
            <input type="time" v-model="startHour" />
          </label>
          <label class="field">
            <span class="field-label">Fim</span>
            <input type="time" v-model="endHour" />
          </label>
        </div>

        <label class="field">
          <span class="field-label"
            >Motivo <span class="text-muted">(opcional)</span></span
          >
          <input
            type="text"
            v-model="reason"
            placeholder="Ex: Trabalho de IA"
            maxlength="255"
          />
        </label>

        <p v-if="error" class="modal-error">{{ error }}</p>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" @click="emit('close')">
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary" :disabled="loading">
            {{ loading ? "Criando..." : "Reservar" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.modal-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 440px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}
.modal-header h3 {
  font-size: 1.15rem;
  font-weight: 700;
}

.btn-close {
  background: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  padding: 0.25rem 0.5rem;
}
.btn-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.field-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-row {
  display: flex;
  gap: 1rem;
}
.field-row .field {
  flex: 1;
}

.modal-error {
  color: var(--danger);
  font-size: 0.85rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}
</style>
