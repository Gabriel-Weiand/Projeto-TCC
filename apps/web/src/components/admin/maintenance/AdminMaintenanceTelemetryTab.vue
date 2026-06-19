<script setup lang="ts">
import { reactive, ref, onMounted, computed } from "vue";
import { useLabConfigStore } from "@/stores/labConfig";
import NumberStepper from "@/components/NumberStepper.vue";
import TelemetryMetricGrid from "@/components/TelemetryMetricGrid.vue";
import {
  DEFAULT_LAB_TELEMETRY_PRESETS,
  TELEMETRY_BATCH_MAX,
  TELEMETRY_INTERVAL_MAX,
  TELEMETRY_PRESET_INTERVAL_MIN,
  clampTelemetryInterval,
  enforceMandatoryTelemetrySet,
  normalizeProcessCaptureConfig,
  validateBatchSize,
  validatePresetInterval,
  validateProcessCaptureTopX,
  type LabTelemetryPresets,
} from "@/utils/telemetryPresets";
import ProcessCaptureOptions from "@/components/ProcessCaptureOptions.vue";

const labStore = useLabConfigStore();
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref(false);

const form = reactive<LabTelemetryPresets>({
  fast: structuredClone(DEFAULT_LAB_TELEMETRY_PRESETS.fast),
  eco: structuredClone(DEFAULT_LAB_TELEMETRY_PRESETS.eco),
});

const presetSections = computed(() => [
  {
    key: "fast" as const,
    title: "Fast (máquina em alocação)",
    hint: "Aplicado automaticamente enquanto houver reserva ativa.",
  },
  {
    key: "eco" as const,
    title: "Eco (máquina ociosa)",
    hint: "Padrão sem reserva e fallback do agente offline.",
  },
]);

const intervalErrors = computed(() => ({
  fast: validatePresetInterval(form.fast.intervalSeconds),
  eco: validatePresetInterval(form.eco.intervalSeconds),
}));

const batchErrors = computed(() => ({
  fast: validateBatchSize(form.fast.batchSize),
  eco: validateBatchSize(form.eco.batchSize),
}));

const processCaptureErrors = computed(() => ({
  fast:
    form.fast.telemetrySet.processCapture
      ? validateProcessCaptureTopX(form.fast.processCaptureConfig.topX)
      : null,
  eco:
    form.eco.telemetrySet.processCapture
      ? validateProcessCaptureTopX(form.eco.processCaptureConfig.topX)
      : null,
}));

const hasValidationErrors = computed(
  () =>
    intervalErrors.value.fast !== null ||
    intervalErrors.value.eco !== null ||
    batchErrors.value.fast !== null ||
    batchErrors.value.eco !== null ||
    processCaptureErrors.value.fast !== null ||
    processCaptureErrors.value.eco !== null,
);

onMounted(async () => {
  loading.value = true;
  try {
    const data = await labStore.fetchLabTelemetryPresets();
    form.fast = {
      ...structuredClone(data.fast),
      telemetrySet: enforceMandatoryTelemetrySet(data.fast.telemetrySet),
      processCaptureConfig: normalizeProcessCaptureConfig(data.fast.processCaptureConfig),
    };
    form.eco = {
      ...structuredClone(data.eco),
      telemetrySet: enforceMandatoryTelemetrySet(data.eco.telemetrySet),
      processCaptureConfig: normalizeProcessCaptureConfig(data.eco.processCaptureConfig),
    };
  } catch {
    const fromConfig = labStore.telemetryPresets;
    form.fast = {
      ...structuredClone(fromConfig.fast),
      telemetrySet: enforceMandatoryTelemetrySet(fromConfig.fast.telemetrySet),
      processCaptureConfig: normalizeProcessCaptureConfig(fromConfig.fast.processCaptureConfig),
    };
    form.eco = {
      ...structuredClone(fromConfig.eco),
      telemetrySet: enforceMandatoryTelemetrySet(fromConfig.eco.telemetrySet),
      processCaptureConfig: normalizeProcessCaptureConfig(fromConfig.eco.processCaptureConfig),
    };
  } finally {
    loading.value = false;
  }
});

async function handleSave() {
  error.value = "";
  saved.value = false;
  if (hasValidationErrors.value) {
    error.value = "Corrija os campos destacados antes de salvar.";
    return;
  }
  saving.value = true;
  try {
    await labStore.saveLabTelemetryPresets({
      fast: {
        intervalSeconds: clampTelemetryInterval(form.fast.intervalSeconds),
        batchSize: form.fast.batchSize,
        telemetrySet: enforceMandatoryTelemetrySet(form.fast.telemetrySet),
        processCaptureConfig: normalizeProcessCaptureConfig(form.fast.processCaptureConfig),
      },
      eco: {
        intervalSeconds: clampTelemetryInterval(form.eco.intervalSeconds),
        batchSize: form.eco.batchSize,
        telemetrySet: enforceMandatoryTelemetrySet(form.eco.telemetrySet),
        processCaptureConfig: normalizeProcessCaptureConfig(form.eco.processCaptureConfig),
      },
    });
    saved.value = true;
  } catch {
    error.value = "Não foi possível salvar os perfis do laboratório.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="maintenance-tab">
    <p class="tab-lead text-secondary">
      Perfis globais <strong>fast</strong> e <strong>eco</strong> para todas as máquinas do laboratório.
      Máquinas em modo <em>custom</em> ignoram estes defaults.
    </p>

    <div v-if="loading" class="empty-state">Carregando…</div>

    <template v-else>
      <div
        v-for="section in presetSections"
        :key="section.key"
        class="card preset-card"
      >
        <h2 class="preset-title">{{ section.title }}</h2>
        <p class="preset-hint text-secondary">{{ section.hint }}</p>
        <div class="preset-fields">
          <div class="preset-field">
            <NumberStepper
              v-model="form[section.key].intervalSeconds"
              label="Intervalo (s)"
              :min="TELEMETRY_PRESET_INTERVAL_MIN"
              :max="TELEMETRY_INTERVAL_MAX"
            />
            <p class="field-hint">
              Entre {{ TELEMETRY_PRESET_INTERVAL_MIN }}s e {{ TELEMETRY_INTERVAL_MAX }}s.
            </p>
            <p v-if="intervalErrors[section.key]" class="field-error">
              {{ intervalErrors[section.key] }}
            </p>
          </div>
          <div class="preset-field">
            <NumberStepper
              v-model="form[section.key].batchSize"
              label="Tamanho do lote"
              :min="1"
              :max="TELEMETRY_BATCH_MAX"
            />
            <p class="field-hint">Entre 1 e {{ TELEMETRY_BATCH_MAX }} amostras.</p>
            <p v-if="batchErrors[section.key]" class="field-error">
              {{ batchErrors[section.key] }}
            </p>
          </div>
        </div>
        <TelemetryMetricGrid v-model="form[section.key].telemetrySet" />
        <ProcessCaptureOptions
          v-if="form[section.key].telemetrySet.processCapture"
          v-model="form[section.key].processCaptureConfig"
        />
        <p v-if="processCaptureErrors[section.key]" class="field-error">
          {{ processCaptureErrors[section.key] }}
        </p>
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>
      <p v-if="saved" class="form-ok">Perfis salvos. Agentes recebem no próximo heartbeat.</p>

      <button
        type="button"
        class="btn btn-primary"
        :disabled="saving || hasValidationErrors"
        @click="handleSave"
      >
        {{ saving ? "Salvando…" : "Salvar perfis do lab" }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.maintenance-tab {
  max-width: 820px;
}
.tab-lead {
  margin-bottom: 1.25rem;
  font-size: 0.9rem;
  line-height: 1.5;
}
.preset-card {
  margin-bottom: 1.25rem;
  padding: 1.1rem 1.25rem;
}
.preset-title {
  font-size: 1rem;
  margin: 0 0 0.35rem;
}
.preset-hint {
  font-size: 0.82rem;
  margin: 0 0 0.85rem;
}
.preset-fields {
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.preset-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.field-error {
  margin: 0;
  font-size: 0.78rem;
  color: var(--danger);
}
.form-error {
  color: var(--danger);
  font-size: 0.88rem;
}
.form-ok {
  color: var(--success);
  font-size: 0.88rem;
}
</style>
