<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import {
  PROCESS_CAPTURE_COMPARE_OPTIONS,
  PROCESS_CAPTURE_TOP_X_OPTIONS,
  PROCESS_CAPTURE_USER_SCOPE_OPTIONS,
  TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
  type ProcessCaptureConfig,
} from "@/utils/telemetryPresets";

const model = defineModel<ProcessCaptureConfig>({ required: true });

const topInput = ref(String(model.value.topX));
const dropdownOpen = ref(false);
const comboboxRef = ref<HTMLElement | null>(null);

watch(
  () => model.value.topX,
  (topX) => {
    topInput.value = String(topX);
  },
);

function clampTop(raw: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return model.value.topX;
  return Math.min(TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX, Math.max(1, n));
}

function commitTopInput() {
  model.value.topX = clampTop(topInput.value);
  topInput.value = String(model.value.topX);
}

function selectTop(top: number) {
  model.value.topX = top;
  topInput.value = String(top);
  dropdownOpen.value = false;
}

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value;
}

function onTopKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    commitTopInput();
    dropdownOpen.value = false;
    (e.target as HTMLInputElement).blur();
  }
  if (e.key === "Escape") {
    topInput.value = String(model.value.topX);
    dropdownOpen.value = false;
    (e.target as HTMLInputElement).blur();
  }
}

function onDocumentClick(e: MouseEvent) {
  if (!comboboxRef.value?.contains(e.target as Node)) {
    dropdownOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onUnmounted(() => document.removeEventListener("click", onDocumentClick));
</script>

<template>
  <div class="process-capture-options">
    <label class="process-field">
      <span class="process-label">Métrica de comparação</span>
      <select v-model="model.compareMetric" class="process-select">
        <option
          v-for="option in PROCESS_CAPTURE_COMPARE_OPTIONS"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </label>
    <label class="process-field">
      <span class="process-label">Escopo de usuários</span>
      <select v-model="model.userScope" class="process-select">
        <option
          v-for="option in PROCESS_CAPTURE_USER_SCOPE_OPTIONS"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </label>
    <div class="process-field">
      <span class="process-label">Top processos</span>
      <div ref="comboboxRef" class="top-combobox">
        <input
          id="process-top-input"
          v-model="topInput"
          type="text"
          inputmode="numeric"
          class="top-combobox-input"
          aria-label="Top processos"
          @blur="commitTopInput"
          @keydown="onTopKeydown"
        />
        <button
          type="button"
          class="top-combobox-toggle"
          :aria-expanded="dropdownOpen"
          aria-label="Opções de Top processos"
          @click.stop="toggleDropdown"
        >
          ▾
        </button>
        <ul v-if="dropdownOpen" class="top-combobox-menu" role="listbox">
          <li
            v-for="top in PROCESS_CAPTURE_TOP_X_OPTIONS"
            :key="top"
            role="option"
            class="top-combobox-option"
            @mousedown.prevent="selectTop(top)"
          >
            Top {{ top }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.process-capture-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px dashed var(--border-subtle);
}

@media (max-width: 720px) {
  .process-capture-options {
    grid-template-columns: 1fr;
  }
}

.process-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.process-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.process-select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-card-solid);
  color: var(--text-primary);
  padding: 0.45rem 0.55rem;
  font-size: 0.85rem;
}

.top-combobox {
  position: relative;
  display: flex;
  align-items: stretch;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-card-solid);
  overflow: visible;
}

.top-combobox-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  padding: 0.45rem 0.55rem;
  font-size: 0.85rem;
  outline: none;
}

.top-combobox-toggle {
  flex-shrink: 0;
  width: 2rem;
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
}

.top-combobox-toggle:hover {
  color: var(--text-primary);
  background: var(--bg-card-solid);
}

.top-combobox-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-card-solid);
  box-shadow: var(--shadow-elevated, 0 4px 12px rgba(0, 0, 0, 0.15));
  max-height: 12rem;
  overflow-y: auto;
}

.top-combobox-option {
  padding: 0.4rem 0.55rem;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--text-primary);
}

.top-combobox-option:hover {
  background: var(--bg-hover);
}
</style>
