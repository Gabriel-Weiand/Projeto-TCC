<script setup lang="ts">
const model = defineModel<number>({ required: true });

const props = withDefaults(
  defineProps<{
    label: string;
    min?: number;
    max?: number;
  }>(),
  { min: 1, max: 600 },
);

function clamp(value: number): number {
  if (!Number.isFinite(value)) return props.min;
  return Math.min(props.max, Math.max(props.min, Math.round(value)));
}

function decrement() {
  model.value = clamp(model.value - 1);
}

function increment() {
  model.value = clamp(model.value + 1);
}

function onBlur() {
  model.value = clamp(model.value);
}
</script>

<template>
  <div class="num-stepper-field">
    <span class="field-label">{{ label }}</span>
    <div class="num-stepper">
      <button
        type="button"
        class="num-stepper-btn"
        :disabled="model <= min"
        aria-label="Diminuir"
        @click="decrement"
      >
        −
      </button>
      <input
        v-model.number="model"
        type="number"
        class="num-stepper-input"
        :min="min"
        :max="max"
        @blur="onBlur"
      />
      <button
        type="button"
        class="num-stepper-btn"
        :disabled="model >= max"
        aria-label="Aumentar"
        @click="increment"
      >
        +
      </button>
    </div>
  </div>
</template>
