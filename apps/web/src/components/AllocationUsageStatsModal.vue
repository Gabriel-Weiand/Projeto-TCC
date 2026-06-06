<script setup lang="ts">
import { ref, watch } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation, AllocationMetric } from "@/types";
import { formatLabAllocationRange } from "@/utils/datetime";
import {
  fmtDurationMinutes,
  fmtGb,
  fmtMbps,
  fmtPct,
  fmtTemp,
  fmtWatts,
  formatChartResolutionLegend,
  metricGb,
  metricTempC,
  metricUsagePct,
} from "@/utils/allocationMetricFormat";
import AllocationSummaryChart from "@/components/allocation/AllocationSummaryChart.vue";

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
          <div>
            <h2 class="modal-title">Estatísticas da sessão</h2>
            <p class="modal-sub">
              {{ machineLabel }} ·
              {{
                formatLabAllocationRange(
                  allocation.startTime,
                  allocation.endTime,
                  lab.timezone,
                )
              }}
            </p>
          </div>
          <button type="button" class="btn-close" aria-label="Fechar" @click="emit('close')">
            ✕
          </button>
        </div>

        <div class="modal-body">
          <div v-if="loading" class="empty-state usage-stats-empty">Carregando...</div>
          <div v-else-if="error" class="empty-state usage-stats-empty">{{ error }}</div>

          <template v-else-if="data">
            <section class="averages-section">
              <h3 class="section-label">Médias e picos</h3>
              <div class="stats-grid">
                <div class="stat-mini stat-mini--wide">
                  <span class="stat-mini-label">Duração</span>
                  <span class="stat-mini-val">{{
                    fmtDurationMinutes(data.sessionDurationMinutes)
                  }}</span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">CPU méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtPct(metricUsagePct(data.avgCpuUsage)) }} /
                    {{ fmtPct(metricUsagePct(data.maxCpuUsage)) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">GPU méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtPct(metricUsagePct(data.avgGpuUsage)) }} /
                    {{ fmtPct(metricUsagePct(data.maxGpuUsage)) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">RAM méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtGb(metricGb(data.avgRamUsedGb)) }} /
                    {{ fmtGb(metricGb(data.maxRamUsedGb)) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">VRAM méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtGb(metricGb(data.avgVramUsedGb)) }} /
                    {{ fmtGb(metricGb(data.maxVramUsedGb)) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Swap méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtGb(metricGb(data.avgSwapUsedGb)) }} /
                    {{ fmtGb(metricGb(data.maxSwapUsedGb)) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Temp CPU máx</span>
                  <span class="stat-mini-val">{{
                    fmtTemp(metricTempC(data.maxCpuTemp))
                  }}</span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Temp GPU máx</span>
                  <span class="stat-mini-val">{{
                    fmtTemp(metricTempC(data.maxGpuTemp))
                  }}</span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Potência GPU méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtWatts(data.avgGpuPowerWatts) }} /
                    {{ fmtWatts(data.maxGpuPowerWatts) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Temp placa-mãe máx</span>
                  <span class="stat-mini-val">{{
                    fmtTemp(metricTempC(data.maxMoboTemp))
                  }}</span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Disco leitura méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtMbps(data.avgDiskReadMbps) }} /
                    {{ fmtMbps(data.maxDiskReadMbps) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Disco escrita méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtMbps(data.avgDiskWriteMbps) }} /
                    {{ fmtMbps(data.maxDiskWriteMbps) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Rede ↓ méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtMbps(data.avgDownloadMbps) }} /
                    {{ fmtMbps(data.maxDownloadMbps) }}
                  </span>
                </div>
                <div class="stat-mini">
                  <span class="stat-mini-label">Rede ↑ méd / máx</span>
                  <span class="stat-mini-val">
                    {{ fmtMbps(data.avgUploadMbps) }} /
                    {{ fmtMbps(data.maxUploadMbps) }}
                  </span>
                </div>
              </div>
              <p class="stats-note text-secondary">
                Valores não capturados (ex.: I/O ou rede no modo eco) aparecem como
                <strong>—</strong> nas médias e não geram linhas no gráfico.
              </p>
            </section>

            <section class="chart-section">
              <div class="chart-section-head">
                <h3 class="section-label">Histórico resumido</h3>
                <span v-if="data.chartSeries?.length" class="chart-resolution text-secondary">
                  {{
                    formatChartResolutionLegend(
                      data.chartSeries.length,
                      data.chartBucketMinutes,
                    )
                  }}
                </span>
              </div>
              <AllocationSummaryChart
                :points="data.chartSeries ?? []"
                :timezone="lab.timezone"
              />
            </section>
          </template>
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
  max-width: 920px;
  width: 100%;
  max-height: min(92vh, 900px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.modal-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.modal-sub {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.modal-body {
  padding: 1.25rem 1.5rem 1.5rem;
  overflow-y: auto;
}

.usage-stats-empty {
  padding: 2rem;
}

.section-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 0 0 0.75rem;
}

.averages-section {
  margin-bottom: 1.25rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.65rem;
}

.stat-mini {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 0.6rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.stat-mini--wide {
  grid-column: span 2;
}

.stat-mini-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.stat-mini-val {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
}

.stats-note {
  margin-top: 0.65rem;
  font-size: 0.78rem;
  line-height: 1.45;
}

.stats-note strong {
  font-weight: 600;
  color: var(--text-secondary);
}

.chart-section {
  border-top: 1px solid var(--border-subtle);
  padding-top: 1.1rem;
}

.chart-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.chart-section-head .section-label {
  margin-bottom: 0;
}

.chart-resolution {
  font-size: 0.78rem;
}

@media (max-width: 720px) {
  .usage-stats-modal {
    max-width: 100%;
  }

  .stat-mini--wide {
    grid-column: span 1;
  }
}
</style>
