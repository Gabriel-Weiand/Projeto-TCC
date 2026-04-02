/* ---- Types ---- */

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
  updatedAt: string | null;
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
  macAddress?: string;
  status: "available" | "occupied" | "maintenance" | "offline";
  lastSeenAt: string | null;
  loggedUser: string | null;
  createdAt: string;
  updatedAt: string | null;
  token?: string;
  latestTelemetry?: RealtimeTelemetry | null;
}

export interface RealtimeTelemetry {
  cpuUsage: number;
  cpuTemp: number;
  gpuUsage: number;
  gpuTemp: number;
  ramUsage: number;
  diskUsage: number | null;
  moboTemperature: number | null;
  downloadUsage: number | null;
  uploadUsage: number | null;
  timestamp: string;
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
  avgDiskUsage: number | null;
  maxDiskUsage: number | null;
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
