<script setup lang="ts">
defineProps<{
  tabs: ReadonlyArray<{ key: string; label: string }>;
  activeKey: string;
  search: string;
  searchPlaceholder?: string;
}>();

const emit = defineEmits<{
  "update:search": [value: string];
  filter: [key: string];
}>();
</script>

<template>
  <div class="allocation-list-toolbar">
    <input
      :value="search"
      type="search"
      class="search-input"
      :placeholder="searchPlaceholder ?? 'Buscar por máquina...'"
      @input="emit('update:search', ($event.target as HTMLInputElement).value)"
    />
  </div>

  <div class="filter-tabs">
    <button
      v-for="t in tabs"
      :key="t.key"
      type="button"
      :class="['tab-btn', { active: activeKey === t.key }]"
      @click="emit('filter', t.key)"
    >
      {{ t.label }}
    </button>
  </div>
</template>
