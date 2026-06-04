/* ---- Types ---- */

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: "user" | "admin";
  systemUsername?: string | null;
  sshPublicKey?: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export type TelemetryPreset = "fast" | "eco" | "custom";

export interface TelemetrySetConfig {
  cpu?: boolean;
  gpu?: boolean;
  ramAndSwap?: boolean;
  diskSpace?: boolean;
  diskIO?: boolean;
  networkIO?: boolean;
  temperatures?: boolean;
  activeUsers?: boolean;
}

export interface CustomAgentConfig {
  intervalSeconds?: number;
  batchSize?: number;
  telemetrySet?: TelemetrySetConfig;
  processThresholds?: Record<string, number>;
  onDemandProcessConfig?: unknown;
}

export interface DiskPartition {
  id: number;
  device: string;
  mountpoint: string;
  fstype: string | null;
  totalGb: number | null;
  freeGb: number | null;
}

export interface MachineGroupSummary {
  id: number;
  title: string;
  description: string | null;
}

export type MachineOperationalMode = "available" | "offline" | "maintenance";

export interface Machine {
  id: number;
  name: string;
  description: string;
  machineGroupId?: number | null;
  group?: MachineGroupSummary | null;
  cpuModel: string | null;
  gpuModel: string | null;
  totalVramGb: number | null;
  totalRamGb: number | null;
  totalDiskGb: number | null;
  ipAddress: string | null;
  /** null = porta SSH 22 */
  sshPort: number | null;
  status: "available" | "occupied" | "maintenance" | "offline" | "disabled";
  /** Modo definido pelo admin: disponível (auto), desativada ou manutenção. */
  operationalMode?: "available" | "offline" | "maintenance";
  lastSeenAt: string | null;
  activeUsers: any[] | null;
  currentSessions?: string[] | null;
  hostFingerprint?: string | null;
  systemUsername?: string | null;
  telemetryPreset?: TelemetryPreset;
  customAgentConfig?: CustomAgentConfig | null;
  createdAt: string;
  updatedAt: string | null;
  token?: string;
  latestTelemetry?: RealtimeTelemetry | null;
  disks?: DiskPartition[];
}

export interface RealtimeTelemetry {
  timestamp: string; // Garantido agora pelo agente
  cpuUsage: number;
  cpuTemp: number;
  cpuFreqMhz?: number | null;
  gpuUsage: number;
  gpuTemp: number;
  gpuPowerWatts?: number | null;
  vramTotalGb?: number | null;
  vramUsedGb?: number | null;
  ramTotalGb?: number | null;
  ramUsedGb?: number | null;
  swapTotalGb?: number | null;
  swapUsedGb?: number | null;
  disks?: any[] | null;
  diskReadMbps: number | null;
  diskWriteMbps: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  moboTemperature?: number | null;
  activeUsers: any[] | null;
}

/** Fase operacional (API calcula a partir de `status` + relógio). */
export type AllocationLifecycleStatus =
  | "pending"
  | "approved"
  | "active"
  | "grace"
  | "sftp"
  | "finished"
  | "denied"
  | "cancelled";

export interface Allocation {
  id: number;
  userId: number;
  machineId: number;
  startTime: string;
  endTime: string;
  reason: string | null;
  status: "pending" | "approved" | "denied" | "cancelled" | "finished";
  /** Presente nas respostas da API; use para badge e ações na UI */
  lifecycleStatus?: AllocationLifecycleStatus;
  userHidden: boolean;
  /** Presente quando a rota retorna dados anonimizados (usuário não-admin) */
  isOwn?: boolean;
  createdAt: string;
  updatedAt: string | null;
  user?: User;
  machine?: Machine;
  metric?: AllocationMetric;
}

export interface AllocationMetric {
  id: number;
  allocationId: number;
  avgCpuUsage: number;
  maxCpuUsage: number;
  avgCpuTemp: number;
  maxCpuTemp: number;
  avgGpuUsage: number;
  maxGpuUsage: number;
  avgGpuTemp: number;
  maxGpuTemp: number;
  avgRamUsage: number;
  maxRamUsage: number;
  // Atualizado para disco I/O
  avgDiskReadMbps: number | null;
  maxDiskReadMbps: number | null;
  avgDiskWriteMbps: number | null;
  maxDiskWriteMbps: number | null;
  avgDownloadMbps: number | null;
  maxDownloadMbps: number | null;
  avgUploadMbps: number | null;
  maxUploadMbps: number | null;
  avgMoboTemp: number | null;
  maxMoboTemp: number | null;
  sessionDurationMinutes: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface Notification {
  id: number;
  userId: number;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface LoginResponse {
  type: string;
  value: string;
  expiresAt: string;
  user: User;
}

export interface PaginatedResponse<T> {
  meta: {
    total: number;
    perPage: number;
    currentPage: number;
    lastPage: number;
    firstPage: number;
  };
  data: T[];
}
