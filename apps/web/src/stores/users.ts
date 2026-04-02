import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/services/api";
import type { User } from "@/types";

export const useUsersStore = defineStore("users", () => {
  const users = ref<User[]>([]);
  const loading = ref(false);

  async function fetchUsers() {
    loading.value = true;
    try {
      const { data } = await api.get<User[]>("/api/v1/users");
      users.value = data;
      return data;
    } finally {
      loading.value = false;
    }
  }

  async function createUser(payload: {
    fullName: string;
    email: string;
    password: string;
    role?: string;
  }) {
    const { data } = await api.post<User>("/api/v1/users", payload);
    users.value.push(data);
    return data;
  }

  async function updateUser(id: number, payload: Record<string, unknown>) {
    const { data } = await api.put<User>(`/api/v1/users/${id}`, payload);
    const idx = users.value.findIndex((u) => u.id === id);
    if (idx !== -1) users.value[idx] = data;
    return data;
  }

  async function deleteUser(id: number) {
    await api.delete(`/api/v1/users/${id}`);
    users.value = users.value.filter((u) => u.id !== id);
  }

  return { users, loading, fetchUsers, createUser, updateUser, deleteUser };
});
