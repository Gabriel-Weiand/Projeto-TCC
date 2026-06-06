import type { AllocationChartPoint } from "@/types";
import {
  TELEMETRY_CHART_COLORS,
  type ChartTabDefinition,
  type SummaryChartTabId,
} from "@/utils/telemetryChartConfig";
import { usageOverTotalPct } from "@/utils/allocationMetricFormat";

function mapField(
  points: AllocationChartPoint[],
  pick: (p: AllocationChartPoint) => number | null | undefined,
): (number | null)[] {
  return points.map((p) => {
    const v = pick(p);
    return v == null || Number.isNaN(v) ? null : v;
  });
}

function hasAnyValue(values: (number | null)[]): boolean {
  return values.some((v) => v != null);
}

function seriesOrEmpty(
  key: string,
  label: string,
  color: string,
  unit: ChartTabDefinition["series"][0]["unit"],
  values: (number | null)[],
) {
  if (!hasAnyValue(values)) return null;
  return { key, label, color, unit, values };
}

export function buildSummaryChartTabs(
  points: AllocationChartPoint[],
): ChartTabDefinition[] {
  if (points.length === 0) return [];

  const tabs: ChartTabDefinition[] = [];

  const usageSeries = [
    seriesOrEmpty(
      "cpu",
      "CPU",
      TELEMETRY_CHART_COLORS.cpu,
      "%",
      mapField(points, (p) => p.cpuUsage),
    ),
    seriesOrEmpty(
      "gpu",
      "GPU",
      TELEMETRY_CHART_COLORS.gpu,
      "%",
      mapField(points, (p) => p.gpuUsage),
    ),
    seriesOrEmpty(
      "ramPct",
      "RAM",
      TELEMETRY_CHART_COLORS.ramPct,
      "%",
      mapField(points, (p) =>
        usageOverTotalPct(p.ramUsedGb, p.ramTotalGb),
      ),
    ),
    seriesOrEmpty(
      "vramPct",
      "VRAM",
      TELEMETRY_CHART_COLORS.vramPct,
      "%",
      mapField(points, (p) =>
        usageOverTotalPct(p.vramUsedGb, p.vramTotalGb),
      ),
    ),
  ].filter((s): s is NonNullable<typeof s> => s != null);

  if (usageSeries.length > 0) {
    tabs.push({ id: "usage", label: "Usos", unit: "%", series: usageSeries });
  }

  const ramSwapSeries = [
    seriesOrEmpty(
      "ramUsed",
      "RAM usada",
      TELEMETRY_CHART_COLORS.ramUsed,
      "GB",
      mapField(points, (p) => p.ramUsedGb),
    ),
    seriesOrEmpty(
      "swapUsed",
      "Swap usado",
      TELEMETRY_CHART_COLORS.swapUsed,
      "GB",
      mapField(points, (p) => p.swapUsedGb),
    ),
  ].filter((s): s is NonNullable<typeof s> => s != null);

  if (ramSwapSeries.length > 0) {
    tabs.push({
      id: "ramSwap",
      label: "RAM / Swap",
      unit: "GB",
      series: ramSwapSeries,
    });
  }

  const vramSeries = [
    seriesOrEmpty(
      "vramUsed",
      "VRAM usada",
      TELEMETRY_CHART_COLORS.vramUsed,
      "GB",
      mapField(points, (p) => p.vramUsedGb),
    ),
  ].filter((s): s is NonNullable<typeof s> => s != null);

  if (vramSeries.length > 0) {
    tabs.push({ id: "vram", label: "VRAM", unit: "GB", series: vramSeries });
  }

  const powerSeries = [
    seriesOrEmpty(
      "gpuPower",
      "GPU",
      TELEMETRY_CHART_COLORS.gpuPower,
      "W",
      mapField(points, (p) => p.gpuPowerWatts),
    ),
  ].filter((s): s is NonNullable<typeof s> => s != null);

  if (powerSeries.length > 0) {
    tabs.push({ id: "power", label: "Potência", unit: "W", series: powerSeries });
  }

  const tempSeries = [
    seriesOrEmpty(
      "cpuTemp",
      "CPU",
      TELEMETRY_CHART_COLORS.cpuTemp,
      "°C",
      mapField(points, (p) => p.cpuTemp),
    ),
    seriesOrEmpty(
      "gpuTemp",
      "GPU",
      TELEMETRY_CHART_COLORS.gpuTemp,
      "°C",
      mapField(points, (p) => p.gpuTemp),
    ),
    seriesOrEmpty(
      "moboTemp",
      "Placa-mãe",
      TELEMETRY_CHART_COLORS.moboTemp,
      "°C",
      mapField(points, (p) => p.moboTemperature),
    ),
  ].filter((s): s is NonNullable<typeof s> => s != null);

  if (tempSeries.length > 0) {
    tabs.push({
      id: "temperatures",
      label: "Temperaturas",
      unit: "°C",
      series: tempSeries,
    });
  }

  return tabs;
}

export function defaultChartTab(tabs: ChartTabDefinition[]): SummaryChartTabId {
  return tabs[0]?.id ?? "usage";
}

export function formatChartAxisLabel(iso: string | null, timezone: string): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${pick("day")}/${pick("month")} ${pick("hour")}:${pick("minute")}`;
  } catch {
    return iso;
  }
}

/** Quantos rótulos de tempo exibir no eixo X (evita sobreposição). */
export function chartAxisTickStep(pointCount: number, maxLabels = 6): number {
  if (pointCount <= maxLabels) return 1;
  return Math.max(1, Math.ceil(pointCount / maxLabels));
}
