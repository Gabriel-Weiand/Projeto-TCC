/** Máximo de amostras por lote enviadas ao agente (8 métricas distintas no total). */
export const TELEMETRY_BATCH_MAX = 15;

export const TELEMETRY_INTERVAL_MAX = 300;
/** Perfis globais fast/eco (admin). */
export const TELEMETRY_PRESET_INTERVAL_MIN = 10;
/** Config custom por máquina. */
export const TELEMETRY_CUSTOM_INTERVAL_MIN = 2;

/** @deprecated Use TELEMETRY_PRESET_INTERVAL_MIN ou TELEMETRY_CUSTOM_INTERVAL_MIN */
export const TELEMETRY_INTERVAL_MIN = TELEMETRY_PRESET_INTERVAL_MIN;

/** Sempre ativas em fast, eco e custom. */
export const MANDATORY_TELEMETRY_METRICS = ["cpu", "ramAndSwap"] as const;

export type TelemetrySetConfig = {
  cpu: boolean;
  gpu: boolean;
  ramAndSwap: boolean;
  diskSpace: boolean;
  diskIO: boolean;
  networkIO: boolean;
  temperatures: boolean;
  activeUsers: boolean;
};

export type TelemetryPresetProfile = {
  intervalSeconds: number;
  batchSize: number;
  telemetrySet: TelemetrySetConfig;
};

export type LabTelemetryPresets = {
  fast: TelemetryPresetProfile;
  eco: TelemetryPresetProfile;
};

export const DEFAULT_LAB_TELEMETRY_PRESETS: LabTelemetryPresets = {
  fast: {
    intervalSeconds: 30,
    batchSize: 4,
    telemetrySet: {
      cpu: true,
      gpu: true,
      ramAndSwap: true,
      diskSpace: true,
      diskIO: true,
      networkIO: true,
      temperatures: true,
      activeUsers: true,
    },
  },
  eco: {
    intervalSeconds: 60,
    batchSize: 15,
    telemetrySet: {
      cpu: true,
      gpu: false,
      ramAndSwap: true,
      diskSpace: true,
      diskIO: false,
      networkIO: false,
      temperatures: false,
      activeUsers: true,
    },
  },
};

export function enforceMandatoryTelemetrySet(
  set: TelemetrySetConfig,
): TelemetrySetConfig {
  const out = { ...set };
  for (const key of MANDATORY_TELEMETRY_METRICS) {
    out[key] = true;
  }
  return out;
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
  { key: "diskSpace", label: "Espaço em disco", mandatory: false },
  { key: "diskIO", label: "I/O de disco", mandatory: false },
  { key: "networkIO", label: "Rede", mandatory: false },
  { key: "temperatures", label: "Temperaturas", mandatory: false },
  { key: "activeUsers", label: "Usuários ativos", mandatory: false },
] as const;
