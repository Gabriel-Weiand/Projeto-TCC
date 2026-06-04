<script setup lang="ts">
import { computed } from "vue";
import type { Machine } from "@/types";
import {
  displayTotalDiskGb,
  formatPartitionFreeTotal,
  getLargestDisk,
  primaryDiskDeviceName,
} from "@/utils/machineDisks";
const props = defineProps<{
  machine: Machine;
}>();

const gpuModelLine = computed(() => props.machine.gpuModel?.trim() || null);

const vramTotalLine = computed(() => {
  const gb = props.machine.totalVramGb;
  if (gb == null || gb <= 0) return null;
  const n = Number(gb);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${text} GB`;
});

const primaryPartition = computed(() => getLargestDisk(props.machine.disks));
const primaryDiskSize = computed(() =>
  primaryPartition.value
    ? formatPartitionFreeTotal(primaryPartition.value.freeGb, primaryPartition.value.totalGb)
    : null,
);

const emit = defineEmits<{
  open: [];
  details: [event: MouseEvent];
}>();

function statusBadge(s: string) {
  const map: Record<string, string> = {
    available: "badge-success",
    occupied: "badge-warning",
    maintenance: "badge-info",
    offline: "badge-danger",
    disabled: "badge-danger",
  };
  return map[s] || "badge-muted";
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    available: "Disponível",
    occupied: "Ocupada",
    maintenance: "Manutenção",
    offline: "Offline",
    disabled: "Desativada",
  };
  return map[s] || s;
}
</script>

<template>
  <div class="card machine-card" @click="emit('open')">
    <div class="mc-header">
      <h3 class="mc-name truncate">{{ machine.name }}</h3>
      <span :class="['badge', statusBadge(machine.status)]">
        {{ statusLabel(machine.status) }}
      </span>
    </div>
    <p class="mc-desc truncate-2">{{ machine.description || "Sem descrição" }}</p>

    <div class="mc-specs">
      <div v-if="machine.cpuModel" class="spec-item spec-item--cpu">
        <span class="spec-label">CPU</span>
        <span class="spec-value spec-value--cpu truncate" :title="machine.cpuModel">
          {{ machine.cpuModel }}
        </span>
      </div>

      <div v-if="gpuModelLine || vramTotalLine" class="spec-row">
        <div v-if="gpuModelLine" class="spec-item spec-item--main">
          <span class="spec-label">GPU</span>
          <span class="spec-value truncate" :title="gpuModelLine">{{ gpuModelLine }}</span>
        </div>
        <div v-if="vramTotalLine" class="spec-item spec-item--side">
          <span class="spec-label">VRAM</span>
          <span class="spec-value">{{ vramTotalLine }}</span>
        </div>
      </div>

      <div
        v-if="machine.totalRamGb || displayTotalDiskGb(machine)"
        class="spec-row"
      >
        <div v-if="machine.totalRamGb" class="spec-item spec-item--main">
          <span class="spec-label">RAM</span>
          <span class="spec-value">{{ machine.totalRamGb }} GB</span>
        </div>
        <div v-if="displayTotalDiskGb(machine)" class="spec-item spec-item--side">
          <span class="spec-label">Disco</span>
          <span class="spec-value">{{ displayTotalDiskGb(machine) }} GB</span>
        </div>
      </div>
    </div>

    <div v-if="primaryDiskDeviceName(machine.disks)" class="mc-disk-highlight">
      <div class="mc-disk-main">
        <span class="mc-disk-label">Disco</span>
        <span
          class="mc-disk-device truncate"
          :title="primaryDiskDeviceName(machine.disks) ?? undefined"
        >
          {{ primaryDiskDeviceName(machine.disks) }}
        </span>
      </div>
      <span
        v-if="primaryDiskSize"
        class="mc-disk-stats"
        :title="primaryDiskSize ?? undefined"
      >
        {{ primaryDiskSize }}
      </span>
    </div>

    <div class="mc-footer">
      <button
        type="button"
        class="btn btn-ghost btn-sm mc-info-btn"
        @click.stop="emit('details', $event)"
      >
        Detalhes
      </button>
      <span class="mc-arrow" aria-hidden="true">→</span>
    </div>
  </div>
</template>

<style scoped>
.machine-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  overflow: hidden;
  transition:
    border-color var(--transition),
    transform var(--transition),
    box-shadow var(--transition);
}
.machine-card:hover {
  border-color: rgba(124, 108, 240, 0.2);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}

.mc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
}
.mc-name {
  font-size: 1.05rem;
  font-weight: 600;
  flex: 1;
  min-width: 0;
}
.mc-desc {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mc-specs {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.spec-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(4.75rem, auto);
  gap: 0.35rem 1.75rem;
  align-items: end;
  min-width: 0;
}

.spec-item {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.spec-item--cpu {
  width: 100%;
}

.spec-value--cpu {
  max-width: 100%;
}

.spec-item--main {
  overflow: hidden;
}

.spec-item--side {
  text-align: right;
  justify-self: end;
  min-width: 4.75rem;
  flex-shrink: 0;
}

.spec-item--side .spec-value {
  white-space: nowrap;
}

.spec-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.spec-value {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.mc-disk-highlight {
  border-top: 1px solid var(--border-subtle);
  padding-top: 0.45rem;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem;
}
.mc-disk-main {
  min-width: 0;
  flex: 1;
}
.mc-disk-label {
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-bottom: 0.15rem;
}
.mc-disk-device {
  display: block;
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-family: ui-monospace, monospace;
}
.mc-disk-stats {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  text-align: right;
}

.mc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
  gap: 0.5rem;
}

.mc-info-btn {
  flex-shrink: 0;
  font-size: 0.78rem;
  padding: 0.3rem 0.65rem;
}

.mc-arrow {
  color: var(--accent);
  font-size: 1rem;
  transition: transform var(--transition);
}
.machine-card:hover .mc-arrow {
  transform: translateX(3px);
}
</style>
