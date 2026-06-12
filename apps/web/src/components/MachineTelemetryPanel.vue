<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import { useMachinesStore } from "@/stores/machines";
import { useLabConfigStore } from "@/stores/labConfig";
import NumberStepper from "@/components/NumberStepper.vue";
import TelemetryMetricGrid from "@/components/TelemetryMetricGrid.vue";
import ProcessCaptureOptions from "@/components/ProcessCaptureOptions.vue";
import {
  TELEMETRY_BATCH_MAX,
  TELEMETRY_CUSTOM_INTERVAL_MIN,
  TELEMETRY_INTERVAL_MAX,
  DEFAULT_PROCESS_CAPTURE_CONFIG,
  clampCustomTelemetryInterval,
  enforceMandatoryTelemetrySet,
  normalizeProcessCaptureConfig,
  validateBatchSize,
  validateCustomInterval,
  validateProcessCaptureTopX,
} from "@/utils/telemetryPresets";
import type { Machine } from "@/types";

/** Modo na UI: automático (fast/eco pelo lab) ou custom explícito do admin. */
type CollectionMode = "automatic" | "custom";

const props = withDefaults(
  defineProps<{ machine: Machine; trigger?: "inline" | "button" }>(),
  { trigger: "inline" },
);
const emit = defineEmits<{ saved: [machine: Machine] }>();

const store = useMachinesStore();
const labConfig = useLabConfigStore();
const saving = ref(false);
const error = ref("");
const saved = ref(false);
const showModal = ref(false);

const mode = ref<CollectionMode>("automatic");

const labPresets = computed(() => labConfig.telemetryPresets);

const automaticSummary = computed(() => {
  const f = labPresets.value.fast;
  const e = labPresets.value.eco;
  return `Em alocação: fast (${f.intervalSeconds}s, lote ${f.batchSize}) · ociosa: eco (${e.intervalSeconds}s, lote ${e.batchSize})`;
});

const MODE_INFO: Record<CollectionMode, { label: string; blurb: string }> = {
  automatic: {
    label: "Automático",
    blurb: "Fast durante reserva ativa; eco sem alocação. Perfis globais do laboratório.",
  },
  custom: {
    label: "Custom",
    blurb: "Intervalo, lote e métricas fixos só nesta máquina.",
  },
};

const activeModeInfo = computed(() => MODE_INFO[mode.value]);

function defaultTelemetrySet() {
  return {
    cpu: true,
    gpu: true,
    ramAndSwap: true,
    disk: true,
    networkIO: true,
    temperatures: true,
    activeUsers: true,
    processCapture: false,
  };
}

const custom = reactive({
  intervalSeconds: 5,
  batchSize: 5,
  telemetrySet: defaultTelemetrySet(),
  processCaptureConfig: { ...DEFAULT_PROCESS_CAPTURE_CONFIG },
});

const customIntervalError = computed(() =>
  mode.value === "custom" ? validateCustomInterval(custom.intervalSeconds) : null,
);
const customBatchError = computed(() =>
  mode.value === "custom" ? validateBatchSize(custom.batchSize) : null,
);
const customProcessCaptureError = computed(() =>
  mode.value === "custom" && custom.telemetrySet.processCapture
    ? validateProcessCaptureTopX(custom.processCaptureConfig.topX)
    : null,
);
const hasCustomValidationErrors = computed(
  () =>
    customIntervalError.value !== null ||
    customBatchError.value !== null ||
    customProcessCaptureError.value !== null,
);

function loadFromMachine(m: Machine) {
  mode.value = m.telemetryPreset === "custom" ? "custom" : "automatic";
  const c = m.customAgentConfig || {};
  custom.intervalSeconds = c.intervalSeconds ?? 5;
  custom.batchSize = c.batchSize ?? 5;
  custom.telemetrySet = enforceMandatoryTelemetrySet({
    ...defaultTelemetrySet(),
    ...(c.telemetrySet || {}),
  });
  custom.processCaptureConfig = normalizeProcessCaptureConfig(
    (c.processCaptureConfig as typeof custom.processCaptureConfig | undefined) ??
      DEFAULT_PROCESS_CAPTURE_CONFIG,
  );
}

watch(() => props.machine, loadFromMachine, { immediate: true });

function selectMode(next: CollectionMode) {
  mode.value = next;
  saved.value = false;
}

function openModal() {
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function handleSave() {
  error.value = "";
  saved.value = false;
  saving.value = true;
  try {
    const payload: Record<string, unknown> = {};

    if (mode.value === "custom") {
      if (hasCustomValidationErrors.value) {
        error.value = "Corrija os campos destacados antes de salvar.";
        return;
      }
      payload.telemetryPreset = "custom";
      payload.customAgentConfig = {
        intervalSeconds: clampCustomTelemetryInterval(custom.intervalSeconds),
        batchSize: custom.batchSize,
        telemetrySet: enforceMandatoryTelemetrySet(custom.telemetrySet),
        processCaptureConfig: normalizeProcessCaptureConfig(custom.processCaptureConfig),
      };
    } else {
      payload.telemetryPreset = "eco";
    }

    const updated = await store.updateMachine(props.machine.id, payload);
    emit("saved", updated);
    saved.value = true;
    if (props.trigger === "button") {
      setTimeout(closeModal, 600);
    }
  } catch {
    error.value = "Não foi possível salvar. Verifique os valores.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <button
    v-if="trigger === 'button'"
    type="button"
    class="btn btn-ghost btn-sm"
    @click="openModal"
  >
    Coleta · {{ activeModeInfo.label }}
  </button>

  <section v-else-if="trigger === 'inline'" class="telemetry-panel card">
    <h2 class="section-title">Coleta de telemetria</h2>
    <div class="panel-inner">
      <p class="panel-hint">
        Padrão do laboratório: <strong>automático</strong> (fast em alocação, eco ociosa).
        Enviado ao agente no próximo heartbeat (~30s).
      </p>

      <div class="preset-row">
        <button
          v-for="(info, key) in MODE_INFO"
          :key="key"
          type="button"
          :class="['preset-btn', { active: mode === key }]"
          @click="selectMode(key as CollectionMode)"
        >
          <span class="preset-name">{{ info.label }}</span>
          <span class="preset-blurb">{{ info.blurb }}</span>
        </button>
      </div>

      <p v-if="mode === 'automatic'" class="auto-summary text-secondary">
        {{ automaticSummary }}
      </p>

      <div v-if="mode === 'custom'" class="custom-block">
        <div class="custom-row">
          <div class="custom-field">
            <NumberStepper
              v-model="custom.intervalSeconds"
              label="Intervalo (s)"
              :min="TELEMETRY_CUSTOM_INTERVAL_MIN"
              :max="TELEMETRY_INTERVAL_MAX"
            />
            <p class="field-hint">
              Entre {{ TELEMETRY_CUSTOM_INTERVAL_MIN }}s e {{ TELEMETRY_INTERVAL_MAX }}s.
            </p>
            <p v-if="customIntervalError" class="field-error">{{ customIntervalError }}</p>
          </div>
          <div class="custom-field">
            <NumberStepper
              v-model="custom.batchSize"
              label="Tamanho do lote"
              :min="1"
              :max="TELEMETRY_BATCH_MAX"
            />
            <p class="field-hint">Entre 1 e {{ TELEMETRY_BATCH_MAX }} amostras.</p>
            <p v-if="customBatchError" class="field-error">{{ customBatchError }}</p>
          </div>
        </div>
        <TelemetryMetricGrid v-model="custom.telemetrySet" class="custom-metrics" />
        <ProcessCaptureOptions
          v-if="custom.telemetrySet.processCapture"
          v-model="custom.processCaptureConfig"
        />
        <p v-if="customProcessCaptureError" class="field-error">
          {{ customProcessCaptureError }}
        </p>
      </div>

      <div class="panel-actions">
        <button
          class="btn btn-primary btn-sm"
          :disabled="saving || (mode === 'custom' && hasCustomValidationErrors)"
          @click="handleSave"
        >
          {{ saving ? "Salvando…" : "Salvar telemetria" }}
        </button>
        <span v-if="saved" class="save-ok">Salvo — agente atualiza no próximo heartbeat.</span>
        <span v-if="error" class="save-err">{{ error }}</span>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="trigger === 'button' && showModal"
      class="modal-overlay"
      @click.self="closeModal"
    >
      <div class="modal-glass fade-in">
        <div class="modal-header">
          <h2 class="modal-title">Coleta de telemetria</h2>
          <button type="button" class="btn-close" @click="closeModal">✕</button>
        </div>
        <div class="modal-body panel-inner">
          <p class="panel-hint">
            Padrão: <strong>automático</strong>. Use <strong>custom</strong> só para exceção nesta máquina.
          </p>

          <div class="preset-row">
            <button
              v-for="(info, key) in MODE_INFO"
              :key="key"
              type="button"
              :class="['preset-btn', { active: mode === key }]"
              @click="selectMode(key as CollectionMode)"
            >
              <span class="preset-name">{{ info.label }}</span>
              <span class="preset-blurb">{{ info.blurb }}</span>
            </button>
          </div>

          <p v-if="mode === 'automatic'" class="auto-summary text-secondary">
            {{ automaticSummary }}
          </p>

          <div v-if="mode === 'custom'" class="custom-block">
            <div class="custom-row">
              <div class="custom-field">
                <NumberStepper
                  v-model="custom.intervalSeconds"
                  label="Intervalo (s)"
                  :min="TELEMETRY_CUSTOM_INTERVAL_MIN"
                  :max="TELEMETRY_INTERVAL_MAX"
                />
                <p class="field-hint">
                  Entre {{ TELEMETRY_CUSTOM_INTERVAL_MIN }}s e {{ TELEMETRY_INTERVAL_MAX }}s.
                </p>
                <p v-if="customIntervalError" class="field-error">{{ customIntervalError }}</p>
              </div>
              <div class="custom-field">
                <NumberStepper
                  v-model="custom.batchSize"
                  label="Tamanho do lote"
                  :min="1"
                  :max="TELEMETRY_BATCH_MAX"
                />
                <p class="field-hint">Entre 1 e {{ TELEMETRY_BATCH_MAX }} amostras.</p>
                <p v-if="customBatchError" class="field-error">{{ customBatchError }}</p>
              </div>
            </div>
            <TelemetryMetricGrid v-model="custom.telemetrySet" class="custom-metrics" />
        <ProcessCaptureOptions
          v-if="custom.telemetrySet.processCapture"
          v-model="custom.processCaptureConfig"
        />
        <p v-if="customProcessCaptureError" class="field-error">
          {{ customProcessCaptureError }}
        </p>
          </div>

          <div class="panel-actions">
            <button
              class="btn btn-primary btn-sm"
              :disabled="saving || (mode === 'custom' && hasCustomValidationErrors)"
              @click="handleSave"
            >
              {{ saving ? "Salvando…" : "Salvar telemetria" }}
            </button>
            <span v-if="saved" class="save-ok">Salvo — agente atualiza no próximo heartbeat.</span>
            <span v-if="error" class="save-err">{{ error }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.telemetry-panel {
  margin-top: 2rem;
  padding: 1.25rem;
}

.panel-hint {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin: 0 0 1rem;
  line-height: 1.45;
}

.auto-summary {
  font-size: 0.78rem;
  margin: 0.75rem 0 0;
  line-height: 1.45;
}

.preset-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}

@media (max-width: 900px) {
  .preset-row {
    grid-template-columns: 1fr;
  }
}

.preset-btn {
  text-align: left;
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card-solid);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.preset-btn:hover {
  border-color: var(--border-glass);
  background: var(--bg-hover);
}

.preset-btn.active {
  border-color: var(--text-muted);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.preset-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.preset-blurb {
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.35;
}

.custom-block {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}

.custom-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.custom-field {
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

.custom-metrics {
  margin-top: 0.85rem;
}

.panel-actions {
  margin-top: 1rem;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.save-ok {
  font-size: 0.8rem;
  color: var(--success);
}

.save-err {
  font-size: 0.8rem;
  color: var(--danger);
}

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
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  background: var(--bg-card-solid);
  z-index: 1;
}

.modal-title {
  font-size: 1.05rem;
  font-weight: 600;
}

.modal-body {
  padding: 1.25rem;
}
</style>
