<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import type { Allocation } from "@/types";
import {
  ALLOCATION_REASON_MAX_LENGTH,
  fmtAllocationDate,
  fmtAllocationTime,
} from "@/utils/allocationLabels";

const props = defineProps<{ allocation: Allocation }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const store = useAllocationsStore();
const form = reactive({ reason: "" });
const saving = ref(false);
const error = ref("");

watch(
  () => props.allocation,
  (a) => {
    form.reason = a.reason || "";
    error.value = "";
  },
  { immediate: true },
);

async function handleSave() {
  error.value = "";
  saving.value = true;
  try {
    await store.updateAllocation(props.allocation.id, {
      reason:
        form.reason.trim().slice(0, ALLOCATION_REASON_MAX_LENGTH) || null,
    });
    emit("saved");
    emit("close");
  } catch {
    error.value = "Não foi possível salvar. Apenas o motivo pode ser alterado.";
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
          <h2 class="modal-title">Editar reserva</h2>
          <button type="button" class="btn-close" @click="emit('close')">✕</button>
        </div>

        <form class="modal-body" @submit.prevent="handleSave">
          <p class="edit-note text-muted">
            Horários não podem ser alterados após o envio. Para mudar datas,
            cancele e crie uma nova reserva.
          </p>

          <div class="readonly-grid">
            <div>
              <span class="field-label">Início</span>
              <p class="readonly-value">
                {{ fmtAllocationDate(allocation.startTime) }}
                {{ fmtAllocationTime(allocation.startTime) }}
              </p>
            </div>
            <div>
              <span class="field-label">Fim</span>
              <p class="readonly-value">
                {{ fmtAllocationDate(allocation.endTime) }}
                {{ fmtAllocationTime(allocation.endTime) }}
              </p>
            </div>
          </div>

          <div class="field">
            <label class="field-label"
              >Motivo
              <span class="text-muted"
                >(máx. {{ ALLOCATION_REASON_MAX_LENGTH }})</span
              ></label
            >
            <textarea
              v-model="form.reason"
              class="field-textarea"
              rows="3"
              :maxlength="ALLOCATION_REASON_MAX_LENGTH"
              placeholder="Descreva o uso da máquina..."
            ></textarea>
            <span class="field-hint text-muted"
              >{{ form.reason.length }}/{{ ALLOCATION_REASON_MAX_LENGTH }}</span
            >
          </div>

          <p v-if="error" class="error-text">{{ error }}</p>

          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" @click="emit('close')">
              Voltar
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? "Salvando..." : "Salvar" }}
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
  margin-top: 0.25rem;
}

.edit-note {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.4;
}

.readonly-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.readonly-value {
  margin: 0.2rem 0 0;
  font-size: 0.9rem;
  font-weight: 500;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}

</style>
