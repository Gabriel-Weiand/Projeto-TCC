<script setup lang="ts">
import { ref, watch } from "vue";
import { brDateToIso, formatBrDateTyping, isoDateToBr } from "@/utils/datetime";

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
const nativeDateRef = ref<HTMLInputElement | null>(null);

watch(
  () => model.value,
  (iso) => {
    display.value = isoDateToBr(iso);
  },
  { immediate: true },
);

function onInput(event: Event) {
  const el = event.target as HTMLInputElement;
  display.value = formatBrDateTyping(el.value);
  el.value = display.value;
  const iso = brDateToIso(display.value);
  if (iso) model.value = iso;
}

function onBlur() {
  const iso = brDateToIso(display.value);
  if (iso) {
    model.value = iso;
    display.value = isoDateToBr(iso);
    return;
  }
  display.value = isoDateToBr(model.value);
}

function onNativeChange(event: Event) {
  const iso = (event.target as HTMLInputElement).value;
  if (!iso) return;
  model.value = iso;
  display.value = isoDateToBr(iso);
}

function openNativePicker() {
  if (props.disabled) return;
  const el = nativeDateRef.value;
  if (!el) return;
  if (typeof el.showPicker === "function") {
    try {
      el.showPicker();
      return;
    } catch {
      /* gesto inválido */
    }
  }
  el.click();
}
</script>

<template>
  <div
    class="lab-wall-date-field"
    :class="{ 'lab-wall-date-field--error': invalid }"
  >
    <input
      :value="display"
      type="text"
      inputmode="numeric"
      maxlength="10"
      placeholder="dd/mm/aaaa"
      class="lab-wall-input lab-wall-input--date lab-wall-input--in-field"
      :class="inputClass"
      :disabled="disabled"
      :aria-label="ariaLabel"
      autocomplete="off"
      @input="onInput"
      @blur="onBlur"
    />
    <div class="lab-wall-date-picker-slot">
      <button
        type="button"
        class="lab-wall-date-picker-trigger"
        :disabled="disabled"
        aria-label="Abrir calendário"
        tabindex="-1"
        @click="openNativePicker"
      >
        <svg
          class="lab-wall-date-picker-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14v10Zm0-12H5V6h14v2Z"
          />
        </svg>
      </button>
      <input
        ref="nativeDateRef"
        type="date"
        class="lab-wall-date-native"
        :value="model"
        :disabled="disabled"
        tabindex="-1"
        aria-hidden="true"
        @change="onNativeChange"
      />
    </div>
  </div>
</template>
