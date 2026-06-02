<script setup lang="ts">
import {
  TELEMETRY_METRIC_KEYS,
  type TelemetrySetConfig,
} from "@/utils/telemetryPresets";

const model = defineModel<TelemetrySetConfig>({ required: true });
</script>

<template>
  <div class="metric-toggle-grid">
    <label
      v-for="m in TELEMETRY_METRIC_KEYS"
      :key="m.key"
      class="metric-toggle"
      :class="{ 'is-checked': model[m.key] }"
    >
      <input
        v-model="model[m.key]"
        type="checkbox"
        class="metric-toggle-input"
      />
      <span class="metric-toggle-box" aria-hidden="true" />
      <span class="metric-toggle-label">{{ m.label }}</span>
    </label>
  </div>
</template>
