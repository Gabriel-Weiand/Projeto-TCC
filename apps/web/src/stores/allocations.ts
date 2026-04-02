import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/services/api";
import type { Allocation, AllocationMetric, PaginatedResponse } from "@/types";

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
    userId?: number;
  }) {
    const { data } = await api.post<Allocation>("/api/v1/allocations", payload);
    allocations.value.unshift(data);
    return data;
  }

  async function updateAllocation(
    id: number,
    payload: Record<string, unknown>,
  ) {
    const { data } = await api.patch<Allocation>(
      `/api/v1/allocations/${id}`,
      payload,
    );
    const idx = allocations.value.findIndex((a) => a.id === id);
    if (idx !== -1) allocations.value[idx] = data;
    return data;
  }

  async function cancelAllocation(id: number) {
    return updateAllocation(id, { status: "cancelled" });
  }

  async function fetchUserAllocations(
    userId: number,
    params?: Record<string, unknown>,
  ) {
    const { data } = await api.get<PaginatedResponse<Allocation>>(
      `/api/v1/users/${userId}/allocations`,
      { params },
    );
    return data;
  }

  async function fetchAllocationSummary(id: number) {
    const { data } = await api.get<AllocationMetric>(
      `/api/v1/allocations/${id}/summary`,
    );
    return data;
  }

  async function softDeleteAllocation(id: number) {
    await api.delete(`/api/v1/allocations/${id}`);
    allocations.value = allocations.value.filter((a) => a.id !== id);
  }

  return {
    allocations,
    loading,
    fetchAllocations,
    createAllocation,
    updateAllocation,
    cancelAllocation,
    fetchUserAllocations,
    fetchAllocationSummary,
    softDeleteAllocation,
  };
});
