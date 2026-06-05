<script setup lang="ts">
import { ref, watch } from "vue";
import {
  formatWallClockTimeTyping,
  normalizeWallClockTime,
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

const display = ref("");

watch(
  () => model.value,
  (value) => {
    display.value = value;
  },
  { immediate: true },
);

function onInput(event: Event) {
  const el = event.target as HTMLInputElement;
  display.value = formatWallClockTimeTyping(el.value);
  el.value = display.value;
  const normalized = normalizeWallClockTime(display.value);
  if (normalized) model.value = normalized;
}

function onBlur() {
  const normalized = normalizeWallClockTime(display.value);
  if (normalized) {
    model.value = normalized;
    display.value = normalized;
    return;
  }
  display.value = model.value;
}
</script>

<template>
  <input
    :value="display"
    type="text"
    inputmode="numeric"
    maxlength="5"
    placeholder="hh:mm"
    class="lab-wall-input lab-wall-input--time"
    :class="[inputClass, { 'lab-wall-input--error': invalid }]"
    :disabled="disabled"
    :aria-label="ariaLabel"
    autocomplete="off"
    @input="onInput"
    @blur="onBlur"
  />
</template>
