<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import type { User } from "@/types";

const props = defineProps<{
  users: User[];
  modelValue: number | "";
  placeholder?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: number | ""] }>();

const open = ref(false);
const search = ref("");
const rootRef = ref<HTMLElement | null>(null);

const selectedUser = computed(() =>
  props.users.find((u) => u.id === Number(props.modelValue)),
);

const filteredUsers = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = props.users.filter((u) => u.role === "user");
  if (!q) return list;
  return list.filter(
    (u) =>
      u.fullName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.systemUsername ?? "").toLowerCase().includes(q),
  );
});

const triggerLabel = computed(() => {
  if (selectedUser.value) {
    return `${selectedUser.value.fullName} (${selectedUser.value.email})`;
  }
  return props.placeholder ?? "Selecione o usuário da reserva";
});

function selectUser(id: number) {
  emit("update:modelValue", id);
  open.value = false;
  search.value = "";
}

function toggleOpen() {
  open.value = !open.value;
  if (open.value) search.value = "";
}

function onClickOutside(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener("click", onClickOutside));
onBeforeUnmount(() => document.removeEventListener("click", onClickOutside));
</script>

<template>
  <div ref="rootRef" class="user-picker">
    <label class="field-label picker-label">Usuário da reserva</label>
    <button type="button" class="picker-trigger" @click="toggleOpen">
      <span class="picker-trigger-name">{{ triggerLabel }}</span>
      <span class="picker-chevron" :class="{ open }">▾</span>
    </button>

    <div v-if="open" class="picker-panel">
      <input
        v-model="search"
        type="search"
        class="picker-search"
        placeholder="Buscar por nome, e-mail ou usuário Unix…"
        autocomplete="off"
        @click.stop
      />
      <ul v-if="filteredUsers.length" class="picker-list">
        <li v-for="u in filteredUsers" :key="u.id">
          <button
            type="button"
            class="picker-item"
            :class="{ 'picker-item--active': modelValue === u.id }"
            @click="selectUser(u.id)"
          >
            <span class="picker-item-name">{{ u.fullName }}</span>
            <span class="picker-item-meta">{{ u.email }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="picker-empty text-muted">Nenhum usuário encontrado.</p>
    </div>
  </div>
</template>

<style scoped>
.user-picker {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.picker-label {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 600;
}

.picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.55rem 0.7rem;
  text-align: left;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  cursor: pointer;
}

.picker-trigger-name {
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-chevron {
  color: var(--text-muted);
  transition: transform 0.15s ease;
}

.picker-chevron.open {
  transform: rotate(180deg);
}

.picker-panel {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-elevated);
  padding: 0.5rem;
}

.picker-search {
  width: 100%;
  padding: 0.45rem 0.65rem;
  font-size: 0.85rem;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  color: var(--text-primary);
  margin-bottom: 0.4rem;
}

.picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
}

.picker-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.picker-item:hover {
  background: var(--bg-hover);
}

.picker-item--active {
  background: var(--accent-soft);
}

.picker-item-name {
  font-size: 0.86rem;
  font-weight: 600;
}

.picker-item-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.picker-empty {
  margin: 0.35rem 0;
  font-size: 0.82rem;
  text-align: center;
}
</style>
