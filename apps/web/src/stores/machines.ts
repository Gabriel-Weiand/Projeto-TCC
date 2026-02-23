import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/services/api";
import type { Machine } from "@/types";

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

  return { machines, loading, fetchMachines };
});
