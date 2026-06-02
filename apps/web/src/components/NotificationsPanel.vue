<script setup lang="ts">
import { ref, watch } from "vue";
import { useNotificationsStore } from "@/stores/notifications";
import { formatLabDateTime } from "@/utils/datetime";
import { displayNotificationMessage } from "@/utils/notificationMessage";
import { useLabConfigStore } from "@/stores/labConfig";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useNotificationsStore();
const lab = useLabConfigStore();
const marking = ref<number | null>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void store.fetchNotifications();
  },
);

function fmt(iso: string) {
  return formatLabDateTime(iso, lab.timezone);
}

async function toggleRead(id: number, isRead: boolean) {
  marking.value = id;
  try {
    await store.markRead(id, !isRead);
  } finally {
    marking.value = null;
  }
}

async function markAll() {
  await store.markAllRead();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="notif-overlay"
      aria-label="Fechar notificações"
      @click.self="emit('close')"
    >
      <aside class="notif-panel fade-in" role="dialog" aria-labelledby="notif-title">
        <header class="notif-header">
          <div>
            <h2 id="notif-title" class="notif-title">Notificações</h2>
            <p v-if="store.unreadCount" class="notif-sub">
              {{ store.unreadCount }} não lida(s)
            </p>
          </div>
          <div class="notif-header-actions">
            <button
              v-if="store.unreadCount"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="markAll"
            >
              Marcar todas lidas
            </button>
            <button type="button" class="btn-close" @click="emit('close')">✕</button>
          </div>
        </header>

        <div v-if="store.loading" class="notif-empty">Carregando…</div>
        <div v-else-if="!store.items.length" class="notif-empty">
          Nenhuma notificação ainda. Aprovações e mudanças de reserva aparecem aqui.
        </div>
        <ul v-else class="notif-list">
          <li
            v-for="n in store.items"
            :key="n.id"
            class="notif-item"
            :class="{ 'notif-item--unread': !n.isRead }"
          >
            <div class="notif-item-top">
              <strong class="notif-item-title">{{ n.title }}</strong>
              <time class="notif-item-time">{{ fmt(n.createdAt) }}</time>
            </div>
            <p class="notif-item-msg">{{ displayNotificationMessage(n.message) }}</p>
            <div class="notif-item-footer">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="marking === n.id"
                @click="toggleRead(n.id, n.isRead)"
              >
                {{ n.isRead ? "Marcar não lida" : "Marcar lida" }}
              </button>
            </div>
          </li>
        </ul>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.notif-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 200;
  display: flex;
  justify-content: flex-end;
}

.notif-panel {
  width: min(420px, 100vw);
  height: 100%;
  background: var(--bg-card-solid);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-elevated);
}

.notif-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.25rem 1.35rem;
  border-bottom: 1px solid var(--border-subtle);
}

.notif-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
}

.notif-sub {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.notif-header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.notif-empty {
  padding: 2rem 1.35rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.notif-item {
  padding: 1rem 1.35rem;
  border-bottom: 1px solid var(--border-subtle);
}

.notif-item--unread {
  background: rgba(102, 126, 234, 0.06);
  box-shadow: inset 3px 0 0 var(--accent);
}

.notif-item-top {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: baseline;
}

.notif-item-title {
  font-size: 0.92rem;
}

.notif-item-time {
  font-size: 0.72rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.notif-item-msg {
  margin: 0.45rem 0 0;
  font-size: 0.86rem;
  color: var(--text-secondary);
  line-height: 1.45;
}

.notif-item-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 0.65rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}
</style>
