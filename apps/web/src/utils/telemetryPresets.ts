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

export const TELEMETRY_METRIC_KEYS = [
  { key: "cpu", label: "CPU" },
  { key: "gpu", label: "GPU" },
  { key: "ramAndSwap", label: "RAM / Swap" },
  { key: "diskSpace", label: "Espaço em disco" },
  { key: "diskIO", label: "I/O de disco" },
  { key: "networkIO", label: "Rede" },
  { key: "temperatures", label: "Temperaturas" },
  { key: "activeUsers", label: "Usuários ativos" },
] as const;
