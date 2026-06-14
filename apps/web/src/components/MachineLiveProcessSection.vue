<script setup lang="ts">
import { computed, ref } from "vue";
import type { TelemetryProcessSnapshot } from "@/types";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import ProcessTelemetryTable from "@/components/process/ProcessTelemetryTable.vue";
import {
  PROCESS_SNAPSHOT_SORT_OPTIONS,
  PROCESS_USER_SCOPE_OPTIONS,
  filterProcessesByUserScope,
  sortProcessSnapshots,
  type ProcessSortDir,
  type ProcessSortKey,
  type ProcessUserScope,
} from "@/utils/processTelemetry";

const props = defineProps<{
  processes: TelemetryProcessSnapshot[] | null;
}>();

const collapsed = ref(false);
const sortKey = ref<ProcessSortKey>("cpuPercent");
const sortDir = ref<ProcessSortDir>("desc");
const userScope = ref<ProcessUserScope>("all");

const filteredProcesses = computed(() => {
  if (!props.processes?.length) return [];
  return filterProcessesByUserScope(props.processes, userScope.value);
});

const sortedProcesses = computed(() => {
  if (!filteredProcesses.value.length) return [];
  return sortProcessSnapshots(filteredProcesses.value, sortKey.value, sortDir.value);
});
</script>

<template>
  <CollapsibleSection v-model:collapsed="collapsed" title="Processos">
    <div class="process-toolbar">
      <p v-if="processes?.length" class="process-meta text-secondary">
        {{ sortedProcesses.length }} processo(s)
        <template v-if="userScope !== 'all'"> (de {{ processes.length }})</template>
      </p>
      <div class="process-controls">
        <label class="process-field">
          <span class="process-label">Usuário</span>
          <select v-model="userScope" class="process-select">
            <option
              v-for="option in PROCESS_USER_SCOPE_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="process-field">
          <span class="process-label">Ordenar por</span>
          <select v-model="sortKey" class="process-select">
            <option
              v-for="option in PROCESS_SNAPSHOT_SORT_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="process-field process-field--dir">
          <span class="process-label">Direção</span>
          <select v-model="sortDir" class="process-select">
            <option value="desc">Decrescente</option>
            <option value="asc">Crescente</option>
          </select>
        </label>
      </div>
    </div>

    <ProcessTelemetryTable mode="snapshot" :snapshots="sortedProcesses" />
  </CollapsibleSection>
</template>

<style scoped>
.process-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 0.85rem;
  margin-bottom: 0.75rem;
}

.process-meta {
  margin: 0;
  font-size: 0.82rem;
}

.process-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.65rem;
}

.process-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 9rem;
}

.process-field--dir {
  min-width: 8rem;
}

.process-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.process-select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-card-solid);
  color: var(--text-primary);
  padding: 0.45rem 0.55rem;
  font-size: 0.85rem;
}
</style>
