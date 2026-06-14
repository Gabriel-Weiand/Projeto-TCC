/** Máximo de amostras por lote enviadas ao agente (8 métricas distintas no total). */
export const TELEMETRY_BATCH_MAX = 15;

export const TELEMETRY_INTERVAL_MAX = 300;
/** Perfis globais fast/eco (admin). */
export const TELEMETRY_PRESET_INTERVAL_MIN = 10;
/** Config custom por máquina. */
export const TELEMETRY_CUSTOM_INTERVAL_MIN = 2;

/** Sempre ativas em fast, eco e custom. */
export const MANDATORY_TELEMETRY_METRICS = ["cpu", "ramAndSwap"] as const;

export type ProcessCaptureCompareMetric =
  | "cpuPercent"
  | "ramMb"
  | "vramMb"
  | "gpuUse"
  | "diskReadKbps"
  | "diskWriteKbps";

export type ProcessCaptureUserScope = "session" | "all";

export type ProcessCaptureConfig = {
  compareMetric: ProcessCaptureCompareMetric;
  topX: number;
  userScope: ProcessCaptureUserScope;
};

export type TelemetrySetConfig = {
  cpu: boolean;
  gpu: boolean;
  ramAndSwap: boolean;
  disk: boolean;
  networkIO: boolean;
  temperatures: boolean;
  activeUsers: boolean;
  processCapture: boolean;
};

export type TelemetryPresetProfile = {
  intervalSeconds: number;
  batchSize: number;
  telemetrySet: TelemetrySetConfig;
  processCaptureConfig: ProcessCaptureConfig;
};

export type LabTelemetryPresets = {
  fast: TelemetryPresetProfile;
  eco: TelemetryPresetProfile;
};

export const DEFAULT_PROCESS_CAPTURE_CONFIG: ProcessCaptureConfig = {
  compareMetric: "cpuPercent",
  topX: 10,
  userScope: "session",
};

export const PROCESS_CAPTURE_USER_SCOPE_OPTIONS = [
  { value: "session", label: "Usuários da sessão" },
  { value: "all", label: "Todos os usuários" },
] as const;

export const PROCESS_CAPTURE_COMPARE_OPTIONS = [
  { value: "cpuPercent", label: "CPU" },
  { value: "ramMb", label: "RAM" },
  { value: "vramMb", label: "VRAM" },
  { value: "gpuUse", label: "Uso GPU (NVIDIA)" },
  { value: "diskReadKbps", label: "I/O leitura" },
  { value: "diskWriteKbps", label: "I/O escrita" },
] as const;

export const PROCESS_CAPTURE_TOP_X_OPTIONS = [5, 10, 15, 20, 30, 50, 100] as const;

/** Limite máximo de processos retornados por amostra (preset ou personalizado). */
export const TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX = 100;

export const DEFAULT_LAB_TELEMETRY_PRESETS: LabTelemetryPresets = {
  fast: {
    intervalSeconds: 30,
    batchSize: 4,
    telemetrySet: {
      cpu: true,
      gpu: true,
      ramAndSwap: true,
      disk: true,
      networkIO: true,
      temperatures: true,
      activeUsers: true,
      processCapture: false,
    },
    processCaptureConfig: { ...DEFAULT_PROCESS_CAPTURE_CONFIG },
  },
  eco: {
    intervalSeconds: 60,
    batchSize: 15,
    telemetrySet: {
      cpu: true,
      gpu: false,
      ramAndSwap: true,
      disk: true,
      networkIO: false,
      temperatures: false,
      activeUsers: true,
      processCapture: false,
    },
    processCaptureConfig: { ...DEFAULT_PROCESS_CAPTURE_CONFIG },
  },
};

export function enforceMandatoryTelemetrySet(
  set: Partial<TelemetrySetConfig> & { diskSpace?: boolean; diskIO?: boolean },
): TelemetrySetConfig {
  const legacyDisk =
    typeof set.disk === "boolean" ? set.disk : !!(set.diskSpace || set.diskIO);
  const out: TelemetrySetConfig = {
    ...DEFAULT_LAB_TELEMETRY_PRESETS.fast.telemetrySet,
    ...set,
    disk: legacyDisk,
    processCapture: set.processCapture === true,
  };
  for (const key of MANDATORY_TELEMETRY_METRICS) {
    out[key] = true;
  }
  return out;
}

export function normalizeProcessCaptureConfig(
  config?: Partial<ProcessCaptureConfig> | null,
): ProcessCaptureConfig {
  const allowed = PROCESS_CAPTURE_COMPARE_OPTIONS.map((o) => o.value);
  const compareMetric = allowed.includes(config?.compareMetric as ProcessCaptureCompareMetric)
    ? (config!.compareMetric as ProcessCaptureCompareMetric)
    : DEFAULT_PROCESS_CAPTURE_CONFIG.compareMetric;
  const topX =
    typeof config?.topX === "number"
      ? Math.min(TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX, Math.max(1, Math.round(config.topX)))
      : DEFAULT_PROCESS_CAPTURE_CONFIG.topX;
  const userScope: ProcessCaptureUserScope =
    config?.userScope === "all" || config?.userScope === "session"
      ? config.userScope
      : DEFAULT_PROCESS_CAPTURE_CONFIG.userScope;
  return { compareMetric, topX, userScope };
}

export function validateProcessCaptureTopX(topX: number): string | null {
  if (
    !Number.isFinite(topX) ||
    topX < 1 ||
    topX > TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX
  ) {
    return `Top deve ser entre 1 e ${TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX}.`;
  }
  return null;
}

export function clampTelemetryInterval(
  seconds: number,
  min = TELEMETRY_PRESET_INTERVAL_MIN,
): number {
  if (!Number.isFinite(seconds)) return min;
  return Math.min(
    TELEMETRY_INTERVAL_MAX,
    Math.max(min, Math.round(seconds)),
  );
}

export function clampCustomTelemetryInterval(seconds: number): number {
  return clampTelemetryInterval(seconds, TELEMETRY_CUSTOM_INTERVAL_MIN);
}

export function validatePresetInterval(seconds: number): string | null {
  if (
    !Number.isFinite(seconds) ||
    seconds < TELEMETRY_PRESET_INTERVAL_MIN ||
    seconds > TELEMETRY_INTERVAL_MAX
  ) {
    return `Intervalo deve ser entre ${TELEMETRY_PRESET_INTERVAL_MIN}s e ${TELEMETRY_INTERVAL_MAX}s.`;
  }
  return null;
}

export function validateCustomInterval(seconds: number): string | null {
  if (
    !Number.isFinite(seconds) ||
    seconds < TELEMETRY_CUSTOM_INTERVAL_MIN ||
    seconds > TELEMETRY_INTERVAL_MAX
  ) {
    return `Intervalo deve ser entre ${TELEMETRY_CUSTOM_INTERVAL_MIN}s e ${TELEMETRY_INTERVAL_MAX}s.`;
  }
  return null;
}

export function validateBatchSize(batchSize: number): string | null {
  if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > TELEMETRY_BATCH_MAX) {
    return `Tamanho do lote deve ser entre 1 e ${TELEMETRY_BATCH_MAX}.`;
  }
  return null;
}

export const TELEMETRY_METRIC_KEYS = [
  { key: "cpu", label: "CPU", mandatory: true },
  { key: "gpu", label: "GPU", mandatory: false },
  { key: "ramAndSwap", label: "RAM / Swap", mandatory: true },
  { key: "disk", label: "Disco (espaço e I/O)", mandatory: false },
  { key: "networkIO", label: "Rede", mandatory: false },
  { key: "temperatures", label: "Temperaturas", mandatory: false },
  { key: "activeUsers", label: "Usuários ativos", mandatory: false },
  { key: "processCapture", label: "Captura de processos", mandatory: false },
] as const;
