<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  formatWallClockPartTyping,
  isWallClockHourValid,
  isWallClockMinuteValid,
  normalizeWallClockParts,
  splitWallClockTime,
} from "@/utils/datetime";

const model = defineModel<string>({ default: "" });

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    invalid?: boolean;
    ariaLabel?: string;
    inputClass?: string;
  }>(),
  { disabled: false, invalid: false, inputClass: "" },
);

const hour = ref("");
const minute = ref("");
const minuteEl = ref<HTMLInputElement | null>(null);
const isEditing = ref(false);

function readFromModel(value: string) {
  const parts = splitWallClockTime(value);
  hour.value = parts.hour;
  minute.value = parts.minute;
}

watch(
  () => model.value,
  (value) => {
    if (isEditing.value) return;
    readFromModel(value);
  },
  { immediate: true },
);

function commit() {
  const normalized = normalizeWallClockParts(hour.value, minute.value);
  if (normalized) model.value = normalized;
}

function onHourInput() {
  isEditing.value = true;
  hour.value = formatWallClockPartTyping(hour.value);
  if (hour.value.length === 2 && isWallClockHourValid(hour.value)) {
    void nextTick(() => minuteEl.value?.focus());
  }
}

function onMinuteInput() {
  isEditing.value = true;
  minute.value = formatWallClockPartTyping(minute.value);
  commit();
}

function onBlur() {
  isEditing.value = false;
  if (!hour.value && !minute.value) {
    model.value = "";
    return;
  }
  if (!isWallClockHourValid(hour.value) || !isWallClockMinuteValid(minute.value)) {
    readFromModel(model.value);
    return;
  }
  const normalized = normalizeWallClockParts(hour.value, minute.value);
  if (normalized) {
    model.value = normalized;
    readFromModel(normalized);
  }
}
</script>

<template>
  <div
    class="lab-wall-time-row lab-wall-input lab-wall-input--time"
    :class="[
      inputClass,
      { 'lab-wall-input--error': invalid },
    ]"
  >
    <input
      v-model="hour"
      type="text"
      inputmode="numeric"
      maxlength="2"
      placeholder="hh"
      class="lab-wall-time-cell"
      :disabled="disabled"
      :aria-label="ariaLabel ? `${ariaLabel}, horas` : 'Horas'"
      autocomplete="off"
      @input="onHourInput"
      @blur="onBlur"
    />
    <span class="lab-wall-time-colon" aria-hidden="true">:</span>
    <input
      ref="minuteEl"
      v-model="minute"
      type="text"
      inputmode="numeric"
      maxlength="2"
      placeholder="mm"
      class="lab-wall-time-cell"
      :disabled="disabled"
      :aria-label="ariaLabel ? `${ariaLabel}, minutos` : 'Minutos'"
      autocomplete="off"
      @input="onMinuteInput"
      @blur="onBlur"
    />
  </div>
</template>

<style scoped>
.lab-wall-time-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.lab-wall-time-cell {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: center;
  appearance: none;
  -webkit-appearance: none;
}

.lab-wall-time-cell:focus {
  outline: none;
}

.lab-wall-time-cell::placeholder {
  color: var(--text-muted);
  opacity: 0.6;
}

.lab-wall-time-colon {
  flex: 0 0 auto;
  color: var(--text-secondary);
  user-select: none;
}
</style>
