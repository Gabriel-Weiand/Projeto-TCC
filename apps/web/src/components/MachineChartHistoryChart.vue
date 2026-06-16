<script setup lang="ts">
import { computed } from "vue";
import { useLabConfigStore } from "@/stores/labConfig";
import { useMachineChartHistory } from "@/composables/useMachineChartHistory";
import { formatChartResolutionLegend } from "@/utils/allocationMetricFormat";
import AllocationSummaryChart from "@/components/allocation/AllocationSummaryChart.vue";

const props = defineProps<{
  machineId: number;
  /** Só faz polling quando a seção está expandida. */
  active?: boolean;
  /** Timestamp do último lote ao vivo — força refresh do gráfico 24 h. */
  liveStamp?: string | null;
}>();

const lab = useLabConfigStore();

const enabled = computed(() => props.active !== false);

const { chartSeries, meta, loading, error } = useMachineChartHistory(
  () => props.machineId,
  { enabled, liveStamp: () => props.liveStamp },
);

const resolutionLegend = computed(() => {
  if (!meta.value?.chartPointCount) return null;
  return formatChartResolutionLegend(
    meta.value.chartPointCount,
    meta.value.chartBucketMinutes,
  );
});
</script>

<template>
  <div class="chart-history-panel">
    <div v-if="resolutionLegend" class="chart-history-head">
      <span class="chart-history-window text-secondary">Últimas 24 h</span>
      <span class="chart-history-resolution text-secondary">{{ resolutionLegend }}</span>
    </div>

    <div v-if="loading && chartSeries.length === 0" class="empty-state chart-loading">
      Carregando histórico…
    </div>
    <div v-else-if="error" class="empty-state chart-error">{{ error }}</div>
    <AllocationSummaryChart
      v-else
      :points="chartSeries"
      :timezone="lab.timezone"
    />
  </div>
</template>

<style scoped>
.chart-history-panel {
  margin-bottom: 0.5rem;
}

.chart-history-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 0.75rem;
}

.chart-history-window {
  font-size: 0.82rem;
  font-weight: 500;
}

.chart-history-resolution {
  font-size: 0.78rem;
}

.chart-loading,
.chart-error {
  padding: 2rem 1rem;
  text-align: center;
  font-size: 0.9rem;
}

.chart-error {
  color: var(--danger);
}
</style>
