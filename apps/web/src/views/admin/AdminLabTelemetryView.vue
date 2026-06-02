<script setup lang="ts">
import { reactive, ref, onMounted, computed } from "vue";
import { useLabConfigStore } from "@/stores/labConfig";
import {
  TELEMETRY_METRIC_KEYS,
  DEFAULT_LAB_TELEMETRY_PRESETS,
  type LabTelemetryPresets,
} from "@/utils/telemetryPresets";

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
  { key: "fast" as const, title: "Fast (todas as máquinas com preset fast)" },
  { key: "eco" as const, title: "Eco (padrão offline do agente + preset eco)" },
]);

onMounted(async () => {
  loading.value = true;
  try {
    const data = await labStore.fetchLabTelemetryPresets();
    form.fast = structuredClone(data.fast);
    form.eco = structuredClone(data.eco);
  } catch {
    const fromConfig = labStore.telemetryPresets;
    form.fast = structuredClone(fromConfig.fast);
    form.eco = structuredClone(fromConfig.eco);
  } finally {
    loading.value = false;
  }
});

async function handleSave() {
  error.value = "";
  saved.value = false;
  for (const key of ["fast", "eco"] as const) {
    const p = form[key];
    if (p.intervalSeconds < 1 || p.batchSize < 1) {
      error.value = "Intervalo e lote devem ser ≥ 1 em fast e eco.";
      return;
    }
  }
  saving.value = true;
  try {
    await labStore.saveLabTelemetryPresets({
      fast: {
        intervalSeconds: form.fast.intervalSeconds,
        batchSize: form.fast.batchSize,
        telemetrySet: { ...form.fast.telemetrySet },
      },
      eco: {
        intervalSeconds: form.eco.intervalSeconds,
        batchSize: form.eco.batchSize,
        telemetrySet: { ...form.eco.telemetrySet },
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
  <div class="fade-in admin-lab-telemetry">
    <h1 class="page-title">Telemetria do laboratório</h1>
    <p class="page-lead text-secondary">
      Perfis <strong>fast</strong> e <strong>eco</strong> valem para todas as máquinas com esse
      preset. O agente usa <strong>eco</strong> enquanto a API não responde. Preset
      <strong>custom</strong> continua por máquina.
    </p>

    <div v-if="loading" class="empty-state">Carregando…</div>

    <template v-else>
      <div
        v-for="section in presetSections"
        :key="section.key"
        class="card preset-card"
      >
        <h2 class="preset-title">{{ section.title }}</h2>
        <div class="preset-fields">
          <label class="field">
            <span class="field-label">Intervalo (s)</span>
            <input
              v-model.number="form[section.key].intervalSeconds"
              type="number"
              min="1"
              max="600"
            />
          </label>
          <label class="field">
            <span class="field-label">Tamanho do lote</span>
            <input
              v-model.number="form[section.key].batchSize"
              type="number"
              min="1"
              max="120"
            />
          </label>
        </div>
        <div class="metrics-grid">
          <label
            v-for="m in TELEMETRY_METRIC_KEYS"
            :key="`${section.key}-${m.key}`"
            class="metric-check"
          >
            <input
              v-model="(form[section.key].telemetrySet as Record<string, boolean>)[m.key]"
              type="checkbox"
            />
            {{ m.label }}
          </label>
        </div>
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>
      <p v-if="saved" class="form-ok">Perfis salvos. Agentes recebem no próximo heartbeat.</p>

      <button
        type="button"
        class="btn btn-primary"
        :disabled="saving"
        @click="handleSave"
      >
        {{ saving ? "Salvando…" : "Salvar perfis do lab" }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.admin-lab-telemetry {
  max-width: 720px;
}
.page-lead {
  margin-bottom: 1.5rem;
  font-size: 0.92rem;
  line-height: 1.5;
}
.preset-card {
  margin-bottom: 1.25rem;
  padding: 1.1rem 1.25rem;
}
.preset-title {
  font-size: 1rem;
  margin: 0 0 0.85rem;
}
.preset-fields {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 140px;
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.4rem 0.75rem;
}
.metric-check {
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
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
