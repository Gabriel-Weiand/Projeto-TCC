/* ---- Types ---- */

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
  updatedAt: string | null;
}

export interface DiskPartition {
  id: number;
  device: string;
  mountpoint: string;
  fstype: string | null;
  totalGb: number | null;
  freeGb: number | null;
}

export interface Machine {
  id: number;
  name: string;
  description: string;
  cpuModel: string | null;
  gpuModel: string | null;
  totalRamGb: number | null;
  totalDiskGb: number | null;
  ipAddress: string | null;
  status: "available" | "occupied" | "maintenance" | "offline";
  lastSeenAt: string | null;
  activeUsers: any[] | null;
  customAgentConfig?: any | null;
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

export interface Allocation {
  id: number;
  userId: number;
  machineId: number;
  startTime: string;
  endTime: string;
  reason: string | null;
  status: "pending" | "approved" | "denied" | "cancelled" | "finished";
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
