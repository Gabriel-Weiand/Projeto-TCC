/** Cores fixas das séries (alinhadas ao tema do laboratório). */
export const TELEMETRY_CHART_COLORS = {
  cpu: "#60a5fa",
  gpu: "#7c6cf0",
  ramPct: "#34d399",
  vramPct: "#a78bfa",
  ramUsed: "#34d399",
  swapUsed: "#fbbf24",
  vramUsed: "#c084fc",
  gpuPower: "#f472b6",
  cpuTemp: "#60a5fa",
  gpuTemp: "#7c6cf0",
  moboTemp: "#fb923c",
  diskRead: "#38bdf8",
  diskWrite: "#2dd4bf",
  download: "#818cf8",
  upload: "#94a3b8",
} as const;

export type SummaryChartTabId =
  | "usage"
  | "ramSwap"
  | "vram"
  | "power"
  | "temperatures";

export interface ChartSeriesDefinition {
  key: string;
  label: string;
  color: string;
  unit: "%" | "GB" | "°C" | "W" | "Mbps";
  values: (number | null)[];
}

export interface ChartTabDefinition {
  id: SummaryChartTabId;
  label: string;
  unit: string;
  series: ChartSeriesDefinition[];
}
