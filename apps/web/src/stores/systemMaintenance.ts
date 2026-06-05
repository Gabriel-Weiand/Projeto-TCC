import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/services/api";
import type { MaintenanceRunResult, SshConnectionAttempt } from "@/types";
import type { PaginatedResponse } from "@/types";

export const useSystemMaintenanceStore = defineStore("systemMaintenance", () => {
  const running = ref(false);
  const pruning = ref(false);

  async function runMaintenance(): Promise<MaintenanceRunResult> {
    running.value = true;
    try {
      const { data } = await api.post<MaintenanceRunResult>(
        "/api/v1/system/maintenance/run",
      );
      return data;
    } finally {
      running.value = false;
    }
  }

  async function pruneNotifications(body?: Record<string, unknown>) {
    pruning.value = true;
    try {
      const { data } = await api.delete<{ deleted: number; message: string }>(
        "/api/v1/system/prune/notifications",
        { data: body },
      );
      return data;
    } finally {
      pruning.value = false;
    }
  }

  async function pruneSshAttempts(body?: Record<string, unknown>) {
    pruning.value = true;
    try {
      const { data } = await api.delete<{ deleted: number; message: string }>(
        "/api/v1/system/prune/ssh-attempts",
        { data: body },
      );
      return data;
    } finally {
      pruning.value = false;
    }
  }

  async function fetchSshAttempts(params?: {
    machineId?: number;
    page?: number;
    limit?: number;
  }) {
    const { data } = await api.get<PaginatedResponse<SshConnectionAttempt>>(
      "/api/v1/ssh-attempts",
      { params },
    );
    return data;
  }

  async function deleteSshAttempt(id: number) {
    await api.delete(`/api/v1/system/ssh-attempts/${id}`);
  }

  return {
    running,
    pruning,
    runMaintenance,
    pruneNotifications,
    pruneSshAttempts,
    fetchSshAttempts,
    deleteSshAttempt,
  };
});
