import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/services/api";
import type { Machine, Allocation, PaginatedResponse } from "@/types";

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

  async function deleteMachine(id: number) {
    await api.delete(`/api/v1/machines/${id}`);
    machines.value = machines.value.filter((m) => m.id !== id);
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
  };
});
