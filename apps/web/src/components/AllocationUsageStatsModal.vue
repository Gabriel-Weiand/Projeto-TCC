<script setup lang="ts">
import { ref, watch } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation, AllocationMetric } from "@/types";
import { formatLabAllocationRange } from "@/utils/datetime";

const props = defineProps<{
  allocation: Allocation;
  machineLabel: string;
}>();

const emit = defineEmits<{ close: [] }>();

const store = useAllocationsStore();
const lab = useLabConfigStore();

const loading = ref(true);
const data = ref<AllocationMetric | null>(null);
const error = ref("");

async function loadSummary() {
  loading.value = true;
  data.value = null;
  error.value = "";
  try {
    data.value = await store.fetchAllocationSummary(props.allocation.id);
  } catch (err: unknown) {
    const code = (err as { response?: { data?: { code?: string } } })?.response
      ?.data?.code;
    if (code === "NO_SUMMARY")
      error.value = "Esta alocação ainda não foi resumida.";
    else error.value = "Erro ao carregar estatísticas.";
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.allocation.id,
  () => void loadSummary(),
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-glass fade-in usage-stats-modal">
        <div class="modal-header">
          <h2 class="modal-title">Estatísticas</h2>
          <button type="button" class="btn-close" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <div class="usage-stats-head">
            <span class="usage-stats-machine">{{ machineLabel }}</span>
            <span class="text-secondary usage-stats-range">
              {{
                formatLabAllocationRange(
                  allocation.startTime,
                  allocation.endTime,
                  lab.timezone,
                )
              }}
            </span>
          </div>

          <div v-if="loading" class="empty-state usage-stats-empty">
            Carregando...
          </div>
          <div v-else-if="error" class="empty-state usage-stats-empty">
            {{ error }}
          </div>
          <div v-else-if="data" class="stats-grid">
            <div class="stat-mini">
              <span class="stat-mini-label">Duração</span>
              <span class="stat-mini-val">{{ data.sessionDurationMinutes }} min</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">CPU Média</span>
              <span class="stat-mini-val">{{ data.avgCpuUsage.toFixed(1) }}%</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">CPU Máx</span>
              <span class="stat-mini-val">{{ data.maxCpuUsage.toFixed(1) }}%</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">CPU Temp Máx</span>
              <span class="stat-mini-val">{{ data.maxCpuTemp.toFixed(0) }}°C</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">GPU Média</span>
              <span class="stat-mini-val">{{ data.avgGpuUsage.toFixed(1) }}%</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">GPU Máx</span>
              <span class="stat-mini-val">{{ data.maxGpuUsage.toFixed(1) }}%</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">GPU Temp Máx</span>
              <span class="stat-mini-val">{{ data.maxGpuTemp.toFixed(0) }}°C</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">RAM Média</span>
              <span class="stat-mini-val">{{ data.avgRamUsage.toFixed(1) }}%</span>
            </div>
            <div class="stat-mini">
              <span class="stat-mini-label">RAM Máx</span>
              <span class="stat-mini-val">{{ data.maxRamUsage.toFixed(1) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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

.usage-stats-modal {
  max-width: 520px;
  width: 100%;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.modal-body {
  padding: 1.5rem;
}

.usage-stats-head {
  margin-bottom: 0.75rem;
}

.usage-stats-machine {
  font-weight: 600;
}

.usage-stats-range {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.85rem;
}

.usage-stats-empty {
  padding: 2rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.75rem;
}

.stat-mini {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 0.65rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.stat-mini-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.stat-mini-val {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}
</style>
