<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import type { Machine } from "@/types";
import { isMachineStatusBlocked } from "@/utils/allocationAvailability";

const props = defineProps<{
  machines: Machine[];
  modelValue: string | number;
  statusLabels: Record<Machine["status"], string>;
  /** Período com início e fim preenchidos e válidos (fim > início). */
  periodReady: boolean;
  /** Legenda de erro do período (ordem ou limite de datas); exibe contorno vermelho. */
  periodErrorMessage?: string | null;
  /** Disponibilidade no período; só relevante com `periodReady` e máquina selecionada. */
  periodAvailable: boolean | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const selectedMachine = computed(() =>
  props.machines.find((m) => m.id === Number(props.modelValue)),
);

function isSelectedMachine(machine: Machine) {
  return selectedMachine.value?.id === machine.id;
}

/** Cores de alocação só no gatilho quando o período está completo e válido. */
function usePeriodToneFor(machine: Machine) {
  return (
    props.periodReady &&
    !props.periodErrorMessage &&
    isSelectedMachine(machine) &&
    props.periodAvailable !== null &&
    !isMachineStatusBlocked(machine.status)
  );
}

function statusTone(machine: Machine) {
  if (machine.status === "offline" || machine.status === "disabled") return "tone-offline";
  if (machine.status === "maintenance") return "tone-maintenance";
  if (machine.status === "occupied") return "tone-occupied";
  return "tone-available";
}

function toneClass(machine: Machine) {
  if (usePeriodToneFor(machine)) {
    return props.periodAvailable ? "tone-period-ok" : "tone-period-busy";
  }
  return statusTone(machine);
}

const triggerCaption = computed(() => {
  if (props.periodErrorMessage) return props.periodErrorMessage;
  const m = selectedMachine.value;
  if (!m) return "Escolha uma máquina para reservar";
  if (usePeriodToneFor(m)) {
    return props.periodAvailable
      ? "Disponível no período selecionado"
      : "Indisponível no período — conflito com outra reserva";
  }
  return props.statusLabels[m.status];
});

const triggerTone = computed(() => {
  if (props.periodErrorMessage) return "tone-period-error";
  if (!selectedMachine.value) return "tone-placeholder";
  return toneClass(selectedMachine.value);
});

function pickerItemClass(m: Machine) {
  const classes = ["picker-item", toneClass(m)];
  if (Number(props.modelValue) === m.id) classes.push("picker-item--active");
  return classes;
}

function selectMachine(id: number) {
  emit("update:modelValue", id);
  open.value = false;
}

function toggleOpen() {
  open.value = !open.value;
}

function onDocumentClick(e: MouseEvent) {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocumentClick));
</script>

<template>
  <div ref="rootRef" class="machine-picker">
    <h3 class="reservation-section-title">Máquina</h3>

    <div class="picker-dropdown" :class="{ 'picker-dropdown--open': open }">
      <button
        type="button"
        class="picker-trigger"
        :class="triggerTone"
        aria-haspopup="listbox"
        :aria-expanded="open"
        @click.stop="toggleOpen"
      >
        <span class="picker-trigger-body">
          <span class="picker-trigger-name">
            {{ selectedMachine?.name ?? "Selecione a máquina" }}
          </span>
          <span class="picker-trigger-caption">{{ triggerCaption }}</span>
        </span>
        <span class="picker-chevron" aria-hidden="true">▾</span>
      </button>

      <div v-if="open" class="picker-menu" role="listbox">
        <button
          v-for="m in machines"
          :key="m.id"
          type="button"
          role="option"
          :aria-selected="Number(modelValue) === m.id"
          :class="pickerItemClass(m)"
          :disabled="isMachineStatusBlocked(m.status)"
          @click="selectMachine(m.id)"
        >
          <span class="picker-item-name">{{ m.name }}</span>
          <span class="picker-item-status">{{ statusLabels[m.status] }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.machine-picker {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.reservation-section-title {
  margin: 0 0 0.35rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}

.picker-dropdown {
  position: relative;
}

.picker-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  background: var(--bg-card-solid);
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.picker-trigger:hover {
  background: var(--bg-hover);
  border-color: var(--border-glass);
}

.picker-dropdown--open .picker-trigger {
  border-color: rgba(124, 108, 240, 0.35);
}

.picker-trigger-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.picker-trigger-name {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.25;
}

.picker-trigger-caption {
  font-size: 0.72rem;
  line-height: 1.3;
  opacity: 0.9;
}

.picker-chevron {
  font-size: 0.85rem;
  color: var(--text-muted);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.picker-dropdown--open .picker-chevron {
  transform: rotate(180deg);
}

.picker-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.35rem);
  left: 0;
  right: 0;
  max-height: 11rem;
  overflow-y: auto;
  padding: 0.35rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card-solid);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
  padding: 0.45rem 0.55rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
}

.picker-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.picker-item--active {
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px rgba(124, 108, 240, 0.12);
}

.picker-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.picker-item-name {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-primary);
}

.picker-item-status {
  font-size: 0.68rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Status da máquina (sem período completo válido) */
.tone-placeholder {
  border-left-color: var(--border-glass);
  color: var(--text-secondary);
}

.tone-offline {
  border-left-color: #ef4444;
  color: #fca5a5;
}

.tone-maintenance {
  border-left-color: #f97316;
  color: #fdba74;
}

.tone-occupied {
  border-left-color: #eab308;
  color: #fde047;
}

.tone-available {
  border-left-color: rgba(34, 197, 94, 0.55);
  color: var(--text-primary);
}

/* Período completo e válido — alocação */
.tone-period-ok {
  border-left-color: #22c55e;
  color: #86efac;
}

.tone-period-busy {
  border-left-color: #ef4444;
  color: #fca5a5;
}

.tone-period-error {
  border-left-color: #ef4444;
  color: #fca5a5;
}

.tone-offline .picker-item-status,
.tone-maintenance .picker-item-status,
.tone-period-ok .picker-item-status,
.tone-period-busy .picker-item-status,
.tone-period-error .picker-item-status {
  color: inherit;
  opacity: 0.88;
}
</style>
