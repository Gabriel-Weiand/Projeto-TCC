import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/services/api";
import type { Allocation, PaginatedResponse } from "@/types";

export const useAllocationsStore = defineStore("allocations", () => {
  const allocations = ref<Allocation[]>([]);
  const loading = ref(false);

  async function fetchAllocations(params?: Record<string, unknown>) {
    loading.value = true;
    try {
      const { data } = await api.get<PaginatedResponse<Allocation>>(
        "/api/v1/allocations",
        { params },
      );
      allocations.value = data.data;
      return data;
    } finally {
      loading.value = false;
    }
  }

  async function createAllocation(payload: {
    machineId: number;
    startTime: string;
    endTime: string;
    reason?: string;
  }) {
    const { data } = await api.post<Allocation>("/api/v1/allocations", payload);
    allocations.value.unshift(data);
    return data;
  }

  async function cancelAllocation(id: number) {
    const { data } = await api.patch<Allocation>(`/api/v1/allocations/${id}`, {
      status: "cancelled",
    });
    const idx = allocations.value.findIndex((a) => a.id === id);
    if (idx !== -1) allocations.value[idx] = data;
    return data;
  }

  return {
    allocations,
    loading,
    fetchAllocations,
    createAllocation,
    cancelAllocation,
  };
});
