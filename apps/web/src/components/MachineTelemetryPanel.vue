<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { Machine, TelemetryPreset } from "@/types";

const props = withDefaults(
  defineProps<{ machine: Machine; trigger?: "inline" | "button" }>(),
  { trigger: "inline" },
);
const emit = defineEmits<{ saved: [machine: Machine] }>();

const store = useMachinesStore();
const saving = ref(false);
const error = ref("");
const saved = ref(false);
const showModal = ref(false);

const preset = ref<TelemetryPreset>("eco");

const PRESET_INFO = {
  fast: {
    label: "Fast",
    intervalSeconds: 30,
    batchSize: 4,
    blurb: "Amostras frequentes, todas as métricas.",
  },
  eco: {
    label: "Eco",
    intervalSeconds: 60,
    batchSize: 15,
    blurb: "Menos carga: intervalo maior, GPU/temp/rede off.",
  },
  custom: { label: "Custom", blurb: "Intervalo, lote e métricas personalizados." },
} as const;

const METRIC_KEYS = [
  { key: "cpu", label: "CPU" },
  { key: "gpu", label: "GPU" },
  { key: "ramAndSwap", label: "RAM / Swap" },
  { key: "diskSpace", label: "Espaço em disco" },
  { key: "diskIO", label: "I/O de disco" },
  { key: "networkIO", label: "Rede" },
  { key: "temperatures", label: "Temperaturas" },
  { key: "activeUsers", label: "Usuários ativos" },
] as const;

function defaultTelemetrySet() {
  return {
    cpu: true,
    gpu: true,
    ramAndSwap: true,
    diskSpace: true,
    diskIO: true,
    networkIO: true,
    temperatures: true,
    activeUsers: true,
  };
}

const custom = reactive({
  intervalSeconds: 5,
  batchSize: 5,
  telemetrySet: defaultTelemetrySet(),
});

const activePresetInfo = computed(() => PRESET_INFO[preset.value]);

function loadFromMachine(m: Machine) {
  preset.value = (m.telemetryPreset as TelemetryPreset) || "eco";
  const c = m.customAgentConfig || {};
  custom.intervalSeconds = c.intervalSeconds ?? 5;
  custom.batchSize = c.batchSize ?? 5;
  custom.telemetrySet = { ...defaultTelemetrySet(), ...(c.telemetrySet || {}) };
}

watch(() => props.machine, loadFromMachine, { immediate: true });

function selectPreset(p: TelemetryPreset) {
  preset.value = p;
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
    const payload: Record<string, unknown> = { telemetryPreset: preset.value };
    if (preset.value === "custom") {
      if (custom.intervalSeconds < 1 || custom.batchSize < 1) {
        error.value = "Intervalo e lote devem ser ≥ 1.";
        return;
      }
      payload.customAgentConfig = {
        intervalSeconds: custom.intervalSeconds,
        batchSize: custom.batchSize,
        telemetrySet: { ...custom.telemetrySet },
      };
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
    Coleta · {{ activePresetInfo.label }}
  </button>

  <section v-else-if="trigger === 'inline'" class="telemetry-panel card">
    <h2 class="section-title">Coleta de telemetria</h2>
    <div class="panel-inner">
      <p class="panel-hint">
        Definido aqui (admin) e enviado ao agente no próximo heartbeat (~30s).
      </p>

      <div class="preset-row">
        <button
          v-for="(info, key) in PRESET_INFO"
          :key="key"
          type="button"
          :class="['preset-btn', { active: preset === key }]"
          @click="selectPreset(key as TelemetryPreset)"
        >
          <span class="preset-name">{{ info.label }}</span>
          <span class="preset-blurb">{{ info.blurb }}</span>
          <span v-if="key !== 'custom'" class="preset-meta">
            {{ info.intervalSeconds }}s · lote {{ info.batchSize }}
          </span>
        </button>
      </div>

      <div v-if="preset === 'custom'" class="custom-block">
        <div class="custom-row">
          <label class="field-label">
            Intervalo (s)
            <input
              v-model.number="custom.intervalSeconds"
              type="number"
              min="1"
              max="600"
              class="field-input"
            />
          </label>
          <label class="field-label">
            Tamanho do lote
            <input
              v-model.number="custom.batchSize"
              type="number"
              min="1"
              max="15"
              class="field-input"
            />
          </label>
        </div>
        <div class="metric-grid">
          <label v-for="m in METRIC_KEYS" :key="m.key" class="metric-check">
            <input v-model="(custom.telemetrySet as any)[m.key]" type="checkbox" />
            {{ m.label }}
          </label>
        </div>
      </div>

      <div class="panel-actions">
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="handleSave">
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
            Definido aqui (admin) e enviado ao agente no próximo heartbeat (~30s).
          </p>

          <div class="preset-row">
            <button
              v-for="(info, key) in PRESET_INFO"
              :key="key"
              type="button"
              :class="['preset-btn', { active: preset === key }]"
              @click="selectPreset(key as TelemetryPreset)"
            >
              <span class="preset-name">{{ info.label }}</span>
              <span class="preset-blurb">{{ info.blurb }}</span>
              <span v-if="key !== 'custom'" class="preset-meta">
                {{ info.intervalSeconds }}s · lote {{ info.batchSize }}
              </span>
            </button>
          </div>

          <div v-if="preset === 'custom'" class="custom-block">
            <div class="custom-row">
              <label class="field-label">
                Intervalo (s)
                <input
                  v-model.number="custom.intervalSeconds"
                  type="number"
                  min="1"
                  max="600"
                  class="field-input"
                />
              </label>
              <label class="field-label">
                Tamanho do lote
                <input
                  v-model.number="custom.batchSize"
                  type="number"
                  min="1"
                  max="15"
                  class="field-input"
                />
              </label>
            </div>
            <div class="metric-grid">
              <label v-for="m in METRIC_KEYS" :key="m.key" class="metric-check">
                <input v-model="(custom.telemetrySet as any)[m.key]" type="checkbox" />
                {{ m.label }}
              </label>
            </div>
          </div>

          <div class="panel-actions">
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="handleSave">
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

.preset-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

.preset-blurb,
.preset-meta {
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
  gap: 1rem;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  min-width: 120px;
}

.field-input {
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 0.88rem;
  max-width: 100px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.4rem 0.75rem;
  margin-top: 0.75rem;
}

.metric-check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.82rem;
  color: var(--text-secondary);
  cursor: pointer;
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
