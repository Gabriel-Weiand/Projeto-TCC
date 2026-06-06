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
    homeMountpoint?: string;
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

  async function finishAllocation(id: number) {
    const { data } = await api.post<Allocation>(
      `/api/v1/allocations/${id}/finish`,
    );
    const idx = allocations.value.findIndex((a) => a.id === id);
    if (idx !== -1) allocations.value[idx] = data;
    return data;
  }

  async function extendAllocation(
    id: number,
    payload: { additionalMinutes: number } | { endTime: string },
  ) {
    const { data } = await api.post<Allocation>(
      `/api/v1/allocations/${id}/extend`,
      payload,
    );
    const idx = allocations.value.findIndex((a) => a.id === id);
    if (idx !== -1) allocations.value[idx] = data;
    return data;
  }

  async function fetchMyAllocations(params?: Record<string, unknown>) {
    loading.value = true;
    try {
      const { data } = await api.get<PaginatedResponse<Allocation>>(
        "/api/v1/allocations/my",
        { params: { limit: 100, ...params } },
      );
      return data.data;
    } finally {
      loading.value = false;
    }
  }

  async function fetchAllocationSummary(id: number) {
    const { data } = await api.get<AllocationMetric>(
      `/api/v1/allocations/${id}/summary`,
    );
    return data;
  }

  async function generateAllocationSummary(id: number) {
    const { data } = await api.post<AllocationMetric>(
      `/api/v1/allocations/${id}/summary`,
    );
    const idx = allocations.value.findIndex((a) => a.id === id);
    if (idx !== -1) {
      allocations.value[idx] = { ...allocations.value[idx]!, metric: data };
    }
    return data;
  }

  async function softDeleteAllocation(id: number) {
    await api.delete(`/api/v1/allocations/${id}`);
    allocations.value = allocations.value.filter((a) => a.id !== id);
  }

  /** Hard delete (admin): remove alocação, telemetrias e métrica em CASCADE. */
  async function hardDeleteAllocation(id: number) {
    await api.delete(`/api/v1/system/allocations/${id}`);
    allocations.value = allocations.value.filter((a) => a.id !== id);
  }

  return {
    allocations,
    loading,
    fetchAllocations,
    createAllocation,
    updateAllocation,
    cancelAllocation,
    finishAllocation,
    extendAllocation,
    fetchMyAllocations,
    fetchAllocationSummary,
    generateAllocationSummary,
    softDeleteAllocation,
    hardDeleteAllocation,
  };
});
