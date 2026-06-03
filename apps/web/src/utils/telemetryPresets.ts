/** Máximo de amostras por lote enviadas ao agente (8 métricas distintas no total). */
export const TELEMETRY_BATCH_MAX = 15;

export const TELEMETRY_INTERVAL_MIN = 1;
export const TELEMETRY_INTERVAL_MAX = 600;

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

export function clampTelemetryInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return TELEMETRY_INTERVAL_MIN;
  return Math.min(
    TELEMETRY_INTERVAL_MAX,
    Math.max(TELEMETRY_INTERVAL_MIN, Math.round(seconds)),
  );
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
