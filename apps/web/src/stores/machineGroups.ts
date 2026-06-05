import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/services/api";
import type { MachineGroup } from "@/types";

export const DEFAULT_GROUP_TITLE = "Outros";

export function sortGroupsForDisplay(groups: MachineGroup[]): MachineGroup[] {
  return [...groups].sort((a, b) => {
    if (a.title === DEFAULT_GROUP_TITLE) return 1;
    if (b.title === DEFAULT_GROUP_TITLE) return -1;
    return a.title.localeCompare(b.title, "pt-BR");
  });
}

export const useMachineGroupsStore = defineStore("machineGroups", () => {
  const groups = ref<MachineGroup[]>([]);
  const loading = ref(false);

  async function fetchGroups() {
    loading.value = true;
    try {
      const { data } = await api.get<MachineGroup[]>("/api/v1/machine-groups");
      groups.value = sortGroupsForDisplay(data);
      return groups.value;
    } finally {
      loading.value = false;
    }
  }

  async function createGroup(payload: {
    title: string;
    description?: string;
    machineIds?: number[];
  }) {
    const { data } = await api.post<MachineGroup>("/api/v1/machine-groups", payload);
    groups.value = sortGroupsForDisplay([...groups.value, data]);
    return data;
  }

  async function updateGroup(
    id: number,
    payload: { title?: string; description?: string; machineIds?: number[] },
  ) {
    const { data } = await api.put<MachineGroup>(`/api/v1/machine-groups/${id}`, payload);
    const idx = groups.value.findIndex((g) => g.id === id);
    if (idx !== -1) groups.value[idx] = data;
    groups.value = sortGroupsForDisplay(groups.value);
    return data;
  }

  async function deleteGroup(id: number) {
    await api.delete(`/api/v1/machine-groups/${id}`);
    groups.value = groups.value.filter((g) => g.id !== id);
  }

  return { groups, loading, fetchGroups, createGroup, updateGroup, deleteGroup };
});
