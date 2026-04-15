<script setup lang="ts">
import { ref, reactive } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import type { Machine } from "@/types";

const props = defineProps<{ machines: Machine[] }>();
const emit = defineEmits<{ close: []; created: [] }>();

const allocations = useAllocationsStore();

const form = reactive({
  machineId: "" as string | number,
  date: "",
  startTime: "",
  endTime: "",
  reason: "",
});

const saving = ref(false);
const error = ref("");

function toLocalIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

async function handleCreate() {
  error.value = "";

  if (!form.machineId || !form.date || !form.startTime || !form.endTime) {
    error.value = "Preencha todos os campos obrigatórios.";
    return;
  }

  if (form.startTime >= form.endTime) {
    error.value = "Horário de início deve ser antes do fim.";
    return;
  }

  const startTime = toLocalIso(form.date, form.startTime);
  const endTime = toLocalIso(form.date, form.endTime);

  saving.value = true;
  try {
    await allocations.createAllocation({
      machineId: Number(form.machineId),
      startTime, // Convertido para UTC via toLocalIso
      endTime, // Convertido para UTC via toLocalIso
      reason: form.reason || undefined,
    });
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

          <div class="field">
            <label class="field-label">Data</label>
            <input v-model="form.date" type="date" />
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label">Início</label>
              <input v-model="form.startTime" type="time" />
            </div>
            <div class="field">
              <label class="field-label">Fim</label>
              <input v-model="form.endTime" type="time" />
            </div>
          </div>

          <div class="field">
            <label class="field-label"
              >Motivo <span class="text-muted">(opcional)</span></label
            >
            <textarea
              v-model="form.reason"
              rows="2"
              placeholder="Ex: Treinamento de modelo ML"
            ></textarea>
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

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}
</style>
