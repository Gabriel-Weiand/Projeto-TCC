import { defineStore } from "pinia";
import { ref, computed } from "vue";
import api from "@/services/api";
import type { User, LoginResponse } from "@/types";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(null);

  const isAuthenticated = computed(() => !!token.value);
  const isAdmin = computed(() => user.value?.role === "admin");

  function loadFromStorage() {
    const savedToken = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");
    if (savedToken && savedUser) {
      token.value = savedToken;
      user.value = JSON.parse(savedUser);
    }
  }

  async function login(email: string, password: string) {
    const { data } = await api.post<LoginResponse>("/api/v1/login", {
      email,
      password,
    });
    token.value = data.value;
    user.value = data.user;
    localStorage.setItem("token", data.value);
    localStorage.setItem("user", JSON.stringify(data.user));
    return data;
  }

  async function logout() {
    try {
      await api.delete("/api/v1/logout");
    } catch {
      /* ignore */
    }
    token.value = null;
    user.value = null;
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }

  async function fetchMe() {
    try {
      const { data } = await api.get<User>("/api/v1/me");
      user.value = data;
      localStorage.setItem("user", JSON.stringify(data));
    } catch {
      await logout();
    }
  }

  async function updateProfile(
    id: number,
    payload: { fullName?: string; email?: string; password?: string },
  ) {
    const { data } = await api.put<User>(`/api/v1/users/${id}`, payload);
    user.value = data;
    localStorage.setItem("user", JSON.stringify(data));
    return data;
  }

  return {
    user,
    token,
    isAuthenticated,
    isAdmin,
    loadFromStorage,
    login,
    logout,
    fetchMe,
    updateProfile,
  };
});
