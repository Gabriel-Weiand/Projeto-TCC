<script setup lang="ts">
export type AdminTab = { id: string; label: string };

defineProps<{
  tabs: AdminTab[];
  modelValue: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <nav class="admin-tab-bar" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="admin-tab"
      :class="{ active: modelValue === tab.id }"
      :aria-selected="modelValue === tab.id"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.admin-tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 1.25rem;
  padding: 0.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.admin-tab {
  padding: 0.5rem 1rem;
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius);
  transition: all var(--transition);
}

.admin-tab:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.admin-tab.active {
  color: var(--text-primary);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px rgba(124, 108, 240, 0.35);
}
</style>
