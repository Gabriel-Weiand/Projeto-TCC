<script setup lang="ts">
import { computed } from "vue";
import type { Machine } from "@/types";
import ReservationMachinePicker from "@/components/ReservationMachinePicker.vue";
import { ALLOCATION_REASON_MAX_LENGTH } from "@/utils/allocationLabels";

const props = withDefaults(
  defineProps<{
    showMachinePicker?: boolean;
    reasonMaxLength?: number;
    machines?: Machine[];
    statusLabels?: Record<Machine["status"], string>;
    periodReady?: boolean;
    periodErrorMessage?: string | null;
    periodAvailable?: boolean | null;
  }>(),
  {
    showMachinePicker: false,
    reasonMaxLength: ALLOCATION_REASON_MAX_LENGTH,
    machines: () => [],
    periodReady: false,
    periodErrorMessage: null,
    periodAvailable: null,
  },
);

const periodHasError = computed(() => !!props.periodErrorMessage);

const machineId = defineModel<string | number>("machineId", { default: "" });
const startDate = defineModel<string>("startDate", { default: "" });
const startTime = defineModel<string>("startTime", { default: "" });
const endDate = defineModel<string>("endDate", { default: "" });
const endTime = defineModel<string>("endTime", { default: "" });
const reason = defineModel<string>("reason", { default: "" });
</script>

<template>
  <div class="reservation-fields">
    <ReservationMachinePicker
      v-if="props.showMachinePicker && props.statusLabels"
      v-model="machineId"
      :machines="props.machines"
      :status-labels="props.statusLabels"
      :period-ready="props.periodReady"
      :period-error-message="props.periodErrorMessage"
      :period-available="props.periodAvailable"
    />

    <section class="reservation-section">
      <h3 class="reservation-section-title">Período</h3>
      <div class="period-grid" :class="{ 'period-grid--error': periodHasError }">
        <div class="period-labels-col">
          <span class="period-tag">Início</span>
          <span class="period-connector" aria-hidden="true">↓</span>
          <span class="period-tag">Fim</span>
        </div>
        <div class="period-fields-col">
          <div class="period-row-inputs">
            <input
              v-model="startDate"
              type="date"
              class="period-input period-input--date"
              :class="{ 'period-input--error': periodHasError }"
              aria-label="Data de início"
            />
            <input
              v-model="startTime"
              type="time"
              class="period-input period-input--time"
              :class="{ 'period-input--error': periodHasError }"
              aria-label="Horário de início"
            />
          </div>
          <div class="period-row-inputs">
            <input
              v-model="endDate"
              type="date"
              class="period-input period-input--date"
              :class="{ 'period-input--error': periodHasError }"
              aria-label="Data de finalização"
            />
            <input
              v-model="endTime"
              type="time"
              class="period-input period-input--time"
              :class="{ 'period-input--error': periodHasError }"
              aria-label="Horário de finalização"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="reservation-section reservation-section--reason">
      <h3 class="reservation-section-title">
        Motivo
        <span class="reservation-section-muted">(opcional)</span>
      </h3>
      <div class="reason-wrap">
        <textarea
          v-model="reason"
          class="reason-input"
          rows="4"
          :maxlength="props.reasonMaxLength"
          placeholder="Ex: Treinamento de modelo ML"
        ></textarea>
        <span class="reason-count text-muted" aria-live="polite">
          {{ reason.length }}/{{ props.reasonMaxLength }}
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.reservation-fields {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  min-height: 0;
}

.reservation-section {
  flex-shrink: 0;
}

.reservation-section-title {
  margin: 0 0 0.35rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}

.reservation-section-muted {
  font-weight: 400;
  color: var(--text-muted);
}

.reservation-fields :deep(.machine-picker) {
  gap: 0.35rem;
}

.reservation-fields :deep(.picker-trigger) {
  padding: 0.55rem 0.7rem;
}

.reservation-fields :deep(.picker-trigger-name) {
  font-size: 0.9rem;
}

.period-grid {
  display: grid;
  grid-template-columns: 3.1rem minmax(0, 1fr);
  column-gap: 0.55rem;
  align-items: stretch;
}

.period-labels-col {
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  align-items: center;
  justify-items: center;
}

.period-tag {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1.2;
  white-space: nowrap;
}

.period-connector {
  font-size: 0.75rem;
  line-height: 1;
  color: var(--text-muted);
  opacity: 0.75;
}

.period-fields-col {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 100%;
}

.period-row-inputs {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.65rem;
  gap: 0.45rem;
  align-items: center;
}

.period-input {
  width: 100%;
  min-width: 0;
  padding: 0.48rem 0.55rem;
  font-size: 0.86rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-family: inherit;
}

.period-input--time {
  padding-left: 0.4rem;
  padding-right: 0.35rem;
  text-align: center;
}

.period-input:focus {
  outline: none;
  border-color: rgba(124, 108, 240, 0.45);
}

.period-input--error {
  border-color: rgba(239, 68, 68, 0.65);
  background: rgba(239, 68, 68, 0.06);
}

.period-input--error:focus {
  border-color: rgba(239, 68, 68, 0.85);
}

.reason-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.reason-input {
  width: 100%;
  resize: none;
  padding: 0.5rem 0.65rem;
  font-size: 0.88rem;
  line-height: 1.4;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-family: inherit;
}

.reason-input:focus {
  outline: none;
  border-color: rgba(124, 108, 240, 0.45);
}

.reason-count {
  font-size: 0.75rem;
  line-height: 1.2;
  text-align: left;
}
</style>
