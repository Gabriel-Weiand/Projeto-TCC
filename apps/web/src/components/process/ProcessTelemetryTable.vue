<script setup lang="ts">
import { computed } from "vue";
import type { ProcessSessionSummary, TelemetryProcessSnapshot } from "@/types";
import {
  fmtAvgMaxKbps,
  fmtAvgMaxMb,
  fmtAvgMaxPct,
  fmtProcessKbps,
  fmtProcessMb,
  fmtProcessPct,
} from "@/utils/processTelemetry";

const props = withDefaults(
  defineProps<{
    mode: "snapshot" | "summary";
    snapshots?: TelemetryProcessSnapshot[] | null;
    summaries?: ProcessSessionSummary[] | null;
  }>(),
  {
    snapshots: null,
    summaries: null,
  },
);

const hasRows = computed(() => {
  if (props.mode === "snapshot") return (props.snapshots?.length ?? 0) > 0;
  return (props.summaries?.length ?? 0) > 0;
});
</script>

<template>
  <div v-if="!hasRows" class="empty-state section-empty">
    Nenhum processo capturado neste período.
  </div>

  <div v-else class="table-wrap process-table-wrap">
    <table class="process-table">
      <thead>
        <tr v-if="mode === 'snapshot'">
          <th>PID</th>
          <th>Nome</th>
          <th>Usuário</th>
          <th>CPU</th>
          <th>RAM</th>
          <th>VRAM</th>
          <th>GPU</th>
          <th>Disco ↓</th>
          <th>Disco ↑</th>
        </tr>
        <tr v-else>
          <th>PID</th>
          <th>Nome</th>
          <th>Usuário</th>
          <th>Amostras</th>
          <th>CPU méd / máx</th>
          <th>RAM méd / máx</th>
          <th>VRAM méd / máx</th>
          <th>GPU méd / máx</th>
          <th>Disco ↓ méd / máx</th>
          <th>Disco ↑ méd / máx</th>
        </tr>
      </thead>
      <tbody v-if="mode === 'snapshot'">
        <tr v-for="row in snapshots" :key="`${row.pid}-${row.name}`">
          <td><code>{{ row.pid }}</code></td>
          <td class="name-col" :title="row.name">{{ row.name }}</td>
          <td>{{ row.username }}</td>
          <td>{{ fmtProcessPct(row.cpuPercent) }}</td>
          <td>{{ fmtProcessMb(row.ramMb) }}</td>
          <td>{{ fmtProcessMb(row.vramMb) }}</td>
          <td>{{ fmtProcessPct(row.gpuUse) }}</td>
          <td>{{ fmtProcessKbps(row.diskReadKbps) }}</td>
          <td>{{ fmtProcessKbps(row.diskWriteKbps) }}</td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr v-for="row in summaries" :key="`${row.pid}-${row.name}`">
          <td><code>{{ row.pid }}</code></td>
          <td class="name-col" :title="row.name">{{ row.name }}</td>
          <td>{{ row.username }}</td>
          <td>{{ row.sampleCount ?? "—" }}</td>
          <td>{{ fmtAvgMaxPct(row.avgCpuPercent, row.maxCpuPercent) }}</td>
          <td>{{ fmtAvgMaxMb(row.avgRamMb, row.maxRamMb) }}</td>
          <td>{{ fmtAvgMaxMb(row.avgVramMb, row.maxVramMb) }}</td>
          <td>{{ fmtAvgMaxPct(row.avgGpuUse, row.maxGpuUse) }}</td>
          <td>{{ fmtAvgMaxKbps(row.avgDiskReadKbps, row.maxDiskReadKbps) }}</td>
          <td>{{ fmtAvgMaxKbps(row.avgDiskWriteKbps, row.maxDiskWriteKbps) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.section-empty {
  padding: 1.5rem 0;
}

.process-table-wrap {
  margin-top: 0.25rem;
}

.process-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.process-table th,
.process-table td {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: middle;
}

.process-table th {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  background: var(--bg-card-solid);
  white-space: nowrap;
}

.process-table tbody tr:hover {
  background: var(--bg-hover);
}

.process-table code {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.name-col {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
</style>
