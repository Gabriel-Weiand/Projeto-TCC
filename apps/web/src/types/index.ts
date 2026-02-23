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
  macAddress: string;
  status: "available" | "occupied" | "maintenance" | "offline";
  lastSeenAt: string | null;
  loggedUser: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Allocation {
  id: number;
  userId: number;
  machineId: number;
  startTime: string;
  endTime: string;
  reason: string | null;
  status: "pending" | "approved" | "denied" | "cancelled" | "finished";
  createdAt: string;
  updatedAt: string | null;
  user?: User;
  machine?: Machine;
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
