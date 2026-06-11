<script setup lang="ts">
import { computed } from "vue";
import type { Machine } from "@/types";
import {
  diskPartitionKey,
  diskUsedPct,
  displayTotalDiskGb,
  sortDisksBySize,
} from "@/utils/machineDisks";
import { formatGpuWithVram } from "@/utils/machineGpu";

const props = defineProps<{
  machine: Machine;
}>();

const emit = defineEmits<{ close: [] }>();

const gpuSpecLine = computed(() =>
  formatGpuWithVram(props.machine.gpuModel, props.machine.totalVramGb),
);

function statusBadge(s: string) {
  const map: Record<string, string> = {
    available: "badge-success",
    occupied: "badge-warning",
    maintenance: "badge-info",
    offline: "badge-danger",
  };
  return map[s] || "badge-muted";
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    available: "Disponível",
    occupied: "Ocupada",
    maintenance: "Manutenção",
    offline: "Offline",
  };
  return map[s] || s;
}

function fmtGb(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(1) + " GB";
}
</script>

<template>
  <Teleport to="body">
    <div class="park-modal-overlay" @click.self="emit('close')">
      <div class="park-modal-panel fade-in" role="dialog" aria-modal="true">
        <div class="park-modal-header">
          <div>
            <h2 class="park-modal-title">{{ machine.name }}</h2>
            <p class="park-modal-desc text-secondary">
              {{ machine.description || "Sem descrição" }}
            </p>
          </div>
          <button type="button" class="btn-close" aria-label="Fechar" @click="emit('close')">
            ✕
          </button>
        </div>

        <div class="park-modal-body">
          <span :class="['badge', statusBadge(machine.status)]">
            {{ statusLabel(machine.status) }}
          </span>

          <dl class="park-spec-list">
            <template v-if="machine.cpuModel">
              <dt>CPU</dt>
              <dd>{{ machine.cpuModel }}</dd>
            </template>
            <template v-if="gpuSpecLine">
              <dt>GPU</dt>
              <dd>{{ gpuSpecLine }}</dd>
            </template>
            <template v-if="machine.totalRamGb">
              <dt>RAM</dt>
              <dd>{{ machine.totalRamGb }} GB</dd>
            </template>
            <template v-if="displayTotalDiskGb(machine)">
              <dt>Capacidade total em disco</dt>
              <dd>{{ displayTotalDiskGb(machine) }} GB (soma das partições)</dd>
            </template>
            <template v-if="machine.group">
              <dt>Grupo</dt>
              <dd>{{ machine.group.title }}</dd>
            </template>
            <template v-if="machine.ipAddress">
              <dt>Endereço IP</dt>
              <dd><code>{{ machine.ipAddress }}</code></dd>
            </template>
          </dl>

          <template v-if="machine.disks && machine.disks.length > 0">
            <h3 class="park-section-title">Partições de disco</h3>
            <div class="park-disk-table">
              <div class="park-disk-header">
                <span>Dispositivo</span>
                <span>Montagem</span>
                <span>FS</span>
                <span>Livre</span>
                <span>Total</span>
                <span>Uso</span>
              </div>
              <div
                v-for="(d, i) in sortDisksBySize(machine.disks)"
                :key="diskPartitionKey(d, i)"
                class="park-disk-row"
              >
                <span><code>{{ d.device }}</code></span>
                <span>{{ d.mountpoint }}</span>
                <span>{{ d.fstype || "—" }}</span>
                <span>{{ fmtGb(d.freeGb) }}</span>
                <span>{{ fmtGb(d.totalGb) }}</span>
                <span class="park-disk-usage">
                  <div class="park-bar-track">
                    <div
                      class="park-bar-fill"
                      :style="{
                        width: diskUsedPct(d.totalGb, d.freeGb) + '%',
                        background:
                          diskUsedPct(d.totalGb, d.freeGb) > 90
                            ? 'var(--danger)'
                            : diskUsedPct(d.totalGb, d.freeGb) > 70
                              ? 'var(--warning)'
                              : 'var(--success)',
                      }"
                    />
                  </div>
                  <span>{{ diskUsedPct(d.totalGb, d.freeGb) }}%</span>
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.park-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.park-modal-panel {
  width: 100%;
  max-width: 42rem;
  max-height: min(88vh, 720px);
  overflow: auto;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-elevated);
}

.park-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.35rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  background: var(--bg-card-solid);
  z-index: 1;
}

.park-modal-title {
  margin: 0 0 0.25rem;
  font-size: 1.35rem;
  font-weight: 700;
}

.park-modal-desc {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
}

.park-modal-body {
  padding: 1rem 1.35rem 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.park-spec-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.45rem 1rem;
  margin: 0;
  font-size: 0.9rem;
}

.park-spec-list dt {
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  padding-top: 0.15rem;
}

.park-spec-list dd {
  margin: 0;
  color: var(--text-primary);
  line-height: 1.45;
  word-break: break-word;
}

.park-section-title {
  margin: 0.25rem 0 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
}

.park-disk-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
  font-size: 0.82rem;
}

.park-disk-header,
.park-disk-row {
  display: grid;
  grid-template-columns: 1.1fr 0.7fr 0.5fr 0.55fr 0.55fr 0.85fr;
  gap: 0.5rem;
  align-items: center;
  padding: 0.55rem 0.65rem;
}

.park-disk-header span,
.park-disk-row > span {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  min-width: 0;
}

.park-disk-header {
  background: var(--bg-hover);
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.park-disk-row {
  border-top: 1px solid var(--border-subtle);
}

.park-disk-row code {
  font-size: 0.78rem;
}

.park-disk-usage {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  width: 100%;
}

.park-bar-track {
  flex: 1;
  height: 6px;
  background: var(--bg-hover);
  border-radius: 3px;
  overflow: hidden;
  min-width: 2rem;
}

.park-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

@media (max-width: 520px) {
  .park-disk-header,
  .park-disk-row {
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }
}
</style>
