import { defineStore } from "pinia";
import { ref } from "vue";
import { isAxiosError } from "axios";
import api from "@/services/api";
import type {
  Machine,
  Allocation,
  PaginatedResponse,
  MachineProvisionedUser,
  MachineAccessType,
  MachineChartHistoryResponse,
} from "@/types";

export const useMachinesStore = defineStore("machines", () => {
  const machines = ref<Machine[]>([]);
  const loading = ref(false);

  async function fetchMachines() {
    loading.value = true;
    try {
      const { data } = await api.get<Machine[]>("/api/v1/machines");
      machines.value = data;
      return data;
    } finally {
      loading.value = false;
    }
  }

  async function fetchMachine(id: number) {
    const { data } = await api.get<Machine>(`/api/v1/machines/${id}`);
    return data;
  }

  async function createMachine(payload: Record<string, unknown>) {
    const { data } = await api.post<Machine>("/api/v1/machines", payload);
    machines.value.push(data);
    return data;
  }

  async function updateMachine(id: number, payload: Record<string, unknown>) {
    const { data } = await api.put<Machine>(`/api/v1/machines/${id}`, payload);
    const idx = machines.value.findIndex((m) => m.id === id);
    if (idx !== -1) machines.value[idx] = data;
    return data;
  }

  async function deleteMachine(
    id: number,
    onPhase?: (phase: "decommissioning") => void,
  ) {
    const maxAttempts = 10;
    const waitMs = 35_000;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    const isTransientDeleteError = (err: unknown) => {
      if (!isAxiosError(err)) return false;
      if (!err.response) return true;
      const status = err.response.status;
      return status >= 500 && status <= 599;
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response;
      try {
        response = await api.delete(`/api/v1/machines/${id}`);
      } catch (err) {
        if (attempt === maxAttempts - 1 || !isTransientDeleteError(err)) {
          throw err;
        }
        await sleep(waitMs);
        continue;
      }

      if (response.status === 204) {
        machines.value = machines.value.filter((m) => m.id !== id);
        return;
      }

      if (response.status === 202) {
        if (attempt === maxAttempts - 1) {
          throw new Error(
            "Descomissionamento ainda em andamento. Aguarde o agente sincronizar e tente excluir novamente.",
          );
        }
        onPhase?.("decommissioning");
        await sleep(waitMs);
        continue;
      }

      throw new Error(`Resposta inesperada ao excluir máquina: HTTP ${response.status}`);
    }
  }

  async function fetchMachineAllocations(
    id: number,
    params?: Record<string, unknown>,
  ) {
    const { data } = await api.get<PaginatedResponse<Allocation>>(
      `/api/v1/machines/${id}/allocations`,
      { params },
    );
    return data;
  }

  async function regenerateToken(id: number) {
    const { data } = await api.post<{ token: string }>(
      `/api/v1/machines/${id}/regenerate-token`,
    );
    return data;
  }

  async function fetchTelemetryStream(
    id: number,
    count?: number,
  ): Promise<{
    machineId: number;
    batch: import("@/types").RealtimeTelemetry[];
    entries: import("@/types").RealtimeTelemetry[];
    latest: import("@/types").RealtimeTelemetry | null;
    total: number;
  }> {
    const params: Record<string, unknown> = {};
    if (count) params.count = count;
    const { data } = await api.get(`/api/v1/machines/${id}/telemetry/stream`, {
      params,
    });
    return data;
  }

  async function fetchProvisionedUsers(machineId: number) {
    const { data } = await api.get<MachineProvisionedUser[]>(
      `/api/v1/machines/${machineId}/provisioned-users`,
    );
    return data;
  }

  async function updateProvisionedUser(
    machineId: number,
    userId: number,
    accessType: MachineAccessType,
  ) {
    const { data } = await api.patch<MachineProvisionedUser[]>(
      `/api/v1/machines/${machineId}/provisioned-users/${userId}`,
      { accessType },
    );
    return data;
  }

  async function removeProvisionedUser(machineId: number, userId: number) {
    await api.delete(`/api/v1/machines/${machineId}/provisioned-users/${userId}`);
    return fetchProvisionedUsers(machineId);
  }

  async function addProvisionedUser(
    machineId: number,
    userId: number,
    accessType: Exclude<MachineAccessType, "auto"> = "shell",
  ) {
    const { data } = await api.post<MachineProvisionedUser[]>(
      `/api/v1/machines/${machineId}/provisioned-users`,
      { userId, accessType },
    );
    return data;
  }

  async function fetchMachineChartHistory(id: number) {
    const { data } = await api.get<{
      chartHistory: MachineChartHistoryResponse;
    }>(`/api/v1/machines/${id}/telemetry`, { params: { limit: 1, page: 1 } });
    return data.chartHistory;
  }

  return {
    machines,
    loading,
    fetchMachines,
    fetchMachine,
    createMachine,
    updateMachine,
    deleteMachine,
    fetchMachineAllocations,
    regenerateToken,
    fetchTelemetryStream,
    fetchMachineChartHistory,
    fetchProvisionedUsers,
    updateProvisionedUser,
    removeProvisionedUser,
    addProvisionedUser,
  };
});
