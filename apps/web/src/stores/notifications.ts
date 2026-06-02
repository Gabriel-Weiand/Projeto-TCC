import { defineStore } from "pinia";
import { ref, computed } from "vue";
import api from "@/services/api";
import type { Notification } from "@/types";

export const useNotificationsStore = defineStore("notifications", () => {
  const items = ref<Notification[]>([]);
  const loading = ref(false);

  const unreadCount = computed(
    () => items.value.filter((n) => !n.isRead).length,
  );

  async function fetchNotifications() {
    loading.value = true;
    try {
      const { data } = await api.get<Notification[]>("/api/v1/notifications");
      items.value = data;
      return data;
    } finally {
      loading.value = false;
    }
  }

  async function markRead(id: number, isRead: boolean) {
    const { data } = await api.patch<Notification>(
      `/api/v1/notifications/${id}/read`,
      { isRead },
    );
    const idx = items.value.findIndex((n) => n.id === id);
    if (idx !== -1) items.value[idx] = data;
    return data;
  }

  async function markAllRead() {
    const unread = items.value.filter((n) => !n.isRead);
    await Promise.all(unread.map((n) => markRead(n.id, true)));
  }

  return {
    items,
    loading,
    unreadCount,
    fetchNotifications,
    markRead,
    markAllRead,
  };
});
