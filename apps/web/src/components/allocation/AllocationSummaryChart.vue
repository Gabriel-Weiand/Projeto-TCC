<script setup lang="ts">
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import type { AllocationChartPoint } from "@/types";
import {
  buildSummaryChartTabs,
  chartAxisTickStep,
  defaultChartTab,
  formatChartAxisLabel,
} from "@/utils/buildAllocationChartTabs";
import type { SummaryChartTabId } from "@/utils/telemetryChartConfig";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

const props = defineProps<{
  points: AllocationChartPoint[];
  timezone: string;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const activeTab = ref<SummaryChartTabId>("usage");

const tabs = computed(() => buildSummaryChartTabs(props.points));
const activeDefinition = computed(
  () => tabs.value.find((t) => t.id === activeTab.value) ?? tabs.value[0] ?? null,
);

/** Teto do eixo Y na aba VRAM = capacidade total reportada (evita escala enganosa). */
const vramAxisMaxGb = computed(() => {
  if (activeTab.value !== "vram") return undefined;
  const totals = props.points
    .map((p) => p.vramTotalGb)
    .filter((v): v is number => v != null && v > 0);
  if (totals.length === 0) return undefined;
  return Math.max(...totals);
});

const labels = computed(() =>
  props.points.map((p) => formatChartAxisLabel(p.timestamp, props.timezone)),
);

const renderSignature = computed(() => {
  const tab = activeDefinition.value;
  if (!tab) return "";
  const seriesKey = tab.series.map((s) => s.values.join(",")).join("|");
  return `${activeTab.value}\0${props.timezone}\0${labels.value.join("\0")}\0${seriesKey}`;
});

let chart: Chart | null = null;
let lastAppliedSignature = "";
let resizeObserver: ResizeObserver | null = null;

function scheduleResize() {
  nextTick(() => {
    requestAnimationFrame(() => {
      chart?.resize();
    });
  });
}

function observeCanvasContainer() {
  resizeObserver?.disconnect();
  const wrap = canvasRef.value?.parentElement;
  if (!wrap) return;
  resizeObserver = new ResizeObserver(() => {
    chart?.resize();
  });
  resizeObserver.observe(wrap);
}

function destroyChart() {
  chart?.destroy();
  chart = null;
  lastAppliedSignature = "";
}

function buildDatasets(tab: NonNullable<typeof activeDefinition.value>) {
  const axisLabels = labels.value;
  return tab.series.map((s) => ({
    label: s.label,
    data: s.values,
    borderColor: s.color,
    backgroundColor: s.color + "22",
    pointRadius: axisLabels.length > 80 ? 0 : axisLabels.length > 40 ? 1 : 2,
    pointHoverRadius: 4,
    borderWidth: 2,
    tension: 0.25,
    spanGaps: false,
    fill: false,
  }));
}

function buildChartOptions(tab: NonNullable<typeof activeDefinition.value>) {
  const gridColor = "rgba(255,255,255,0.06)";
  const tickColor = "#9595b0";
  const axisLabels = labels.value;
  const tickStep = chartAxisTickStep(axisLabels.length, 6);
  const lastIndex = axisLabels.length - 1;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: { color: tickColor, boxWidth: 10, usePointStyle: true },
      },
      tooltip: {
        callbacks: {
          label(ctx: { dataset: { label?: string }; parsed: { y: number | null } }) {
            const v = ctx.parsed.y;
            if (v == null) return `${ctx.dataset.label}: —`;
            const unit = tab.unit;
            const formatted =
              unit === "%"
                ? `${v.toFixed(1)}%`
                : unit === "°C"
                  ? `${v.toFixed(1)}°C`
                  : unit === "W"
                    ? `${Math.round(v)} W`
                    : unit === "Mbps"
                      ? `${v.toFixed(1)} Mbps`
                      : `${v.toFixed(1)} ${unit}`;
            return `${ctx.dataset.label}: ${formatted}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: tickColor,
          maxRotation: 0,
          autoSkip: false,
          font: { size: 10 },
          callback(_value: unknown, index: number) {
            if (index == null || index < 0) return "";
            if (index !== 0 && index !== lastIndex && index % tickStep !== 0) {
              return "";
            }
            return axisLabels[index] ?? "";
          },
        },
        grid: { color: gridColor },
      },
      y: {
        ticks: { color: tickColor },
        grid: { color: gridColor },
        suggestedMax:
          tab.id === "vram" && vramAxisMaxGb.value != null
            ? vramAxisMaxGb.value
            : undefined,
        title: {
          display: true,
          text: tab.unit,
          color: tickColor,
        },
      },
    },
  };
}

function syncChart() {
  const canvas = canvasRef.value;
  const tab = activeDefinition.value;
  const signature = renderSignature.value;

  if (!canvas || !tab || tabs.value.length === 0) {
    destroyChart();
    return;
  }

  if (signature === lastAppliedSignature && chart) return;

  if (!chart) {
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels.value,
        datasets: buildDatasets(tab),
      },
      options: buildChartOptions(tab),
    });
    lastAppliedSignature = signature;
    scheduleResize();
    return;
  }

  chart.data.labels = labels.value;
  chart.data.datasets = buildDatasets(tab);
  chart.options = buildChartOptions(tab);
  chart.update("none");
  lastAppliedSignature = signature;
  scheduleResize();
}

watch(renderSignature, () => {
  if (tabs.value.length > 0 && !tabs.value.some((t) => t.id === activeTab.value)) {
    activeTab.value = defaultChartTab(tabs.value);
    return;
  }
  syncChart();
});

onMounted(() => {
  if (tabs.value.length > 0) {
    activeTab.value = defaultChartTab(tabs.value);
  }
  syncChart();
  observeCanvasContainer();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  destroyChart();
});

watch(canvasRef, (el) => {
  if (!el) return;
  observeCanvasContainer();
  syncChart();
});
</script>

<template>
  <div v-if="tabs.length === 0" class="chart-empty text-secondary">
    Sem pontos de telemetria neste resumo. Métricas de I/O ou rede podem não ter sido
    capturadas no período.
  </div>
  <div v-else class="chart-layout">
    <div class="chart-main">
      <div class="chart-canvas-wrap">
        <canvas ref="canvasRef" aria-label="Gráfico de telemetria da sessão" />
      </div>
    </div>
    <nav class="chart-tabs" aria-label="Tipos de métrica">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="chart-tab"
        :class="{ active: tab.id === activeTab }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>
  </div>
</template>

<style scoped>
.chart-layout {
  display: flex;
  gap: 1rem;
  min-height: 280px;
}

.chart-main {
  flex: 1;
  min-width: 0;
}

.chart-canvas-wrap {
  height: 280px;
  position: relative;
}

.chart-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex-shrink: 0;
  width: 8.5rem;
}

.chart-tab {
  text-align: left;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--transition),
    border-color var(--transition),
    color var(--transition);
}

.chart-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.chart-tab.active {
  background: var(--accent-soft);
  border-color: rgba(124, 108, 240, 0.35);
  color: var(--text-primary);
}

.chart-empty {
  padding: 2rem 1rem;
  text-align: center;
  font-size: 0.9rem;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius);
}
</style>
