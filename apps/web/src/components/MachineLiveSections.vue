<script setup lang="ts">
import { ref } from "vue";
import type { Machine, RealtimeTelemetry } from "@/types";
import {
  diskPartitionKey,
  diskUsedPct as diskUsedPctUtil,
  sortDisksBySize,
} from "@/utils/machineDisks";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import MachineIdleHistoryChart from "@/components/MachineIdleHistoryChart.vue";

withDefaults(
  defineProps<{
    machine: Machine;
    machineId: number;
    liveData: RealtimeTelemetry | null;
    /** Bloco CPU/GPU/RAM/rede em tempo real (somente admin). */
    showTelemetry?: boolean;
    /** Gráfico 24 h (somente admin). */
    showCharts?: boolean;
  }>(),
  { showTelemetry: true, showCharts: false },
);

const telemetryCollapsed = ref(false);
const chartsCollapsed = ref(false);
const disksCollapsed = ref(false);

function calcUsagePct(
  used: number | null | undefined,
  total: number | null | undefined,
): string {
  if (used == null || total == null || total === 0) return "—";
  return ((used / total) * 100).toFixed(1);
}

function calcUsageColor(
  used: number | null | undefined,
  total: number | null | undefined,
): string {
  if (used == null || total == null || total === 0) return "var(--text-muted)";
  const pct = (used / total) * 100;
  if (pct < 50) return "var(--success)";
  if (pct < 80) return "var(--warning)";
  return "var(--danger)";
}

function usageColor(val: number | null | undefined): string {
  if (val == null) return "var(--text-muted)";
  if (val < 50) return "var(--success)";
  if (val < 80) return "var(--warning)";
  return "var(--danger)";
}

function tempColor(val: number | null | undefined): string {
  if (val == null) return "var(--text-muted)";
  if (val < 60) return "var(--success)";
  if (val < 80) return "var(--warning)";
  return "var(--danger)";
}

function fmtGb(val: number | null | undefined): string {
  if (val == null) return "--";
  return val.toFixed(1) + " GB";
}

function fmtRamGb(val: number | null | undefined): string {
  if (val == null) return "--";
  return val.toFixed(1) + " GB";
}

function fmtPct(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(1);
}

function fmtTemp(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(1);
}

function fmtMbps(val: number | null | undefined): string {
  if (val == null) return "—";
  return Number(val).toFixed(1);
}

function diskUsedPct(total: number | null, free: number | null): number {
  return diskUsedPctUtil(total, free);
}
</script>

<template>
  <div class="machine-sections">
    <CollapsibleSection
      v-if="showTelemetry"
      v-model:collapsed="telemetryCollapsed"
      title="Telemetria"
    >
      <div v-if="liveData" class="telemetry-grid">
        <div class="tele-card">
          <span class="tele-label">CPU</span>
          <div class="tele-value" :style="{ color: usageColor(liveData.cpuUsage) }">
            {{ fmtPct(liveData.cpuUsage) }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: (liveData.cpuUsage ?? 0) + '%',
                background: usageColor(liveData.cpuUsage),
              }"
            ></div>
          </div>
          <div class="tele-sub-row">
            <span class="tele-sub" :style="{ color: tempColor(liveData.cpuTemp) }">
              {{ fmtTemp(liveData.cpuTemp) }} °C
            </span>
            <span v-if="liveData.cpuFreqMhz" class="tele-sub tele-muted">
              {{ liveData.cpuFreqMhz }} MHz
            </span>
          </div>
        </div>

        <div class="tele-card">
          <div class="tele-label-row">
            <span class="tele-label">GPU</span>
            <span
              v-if="liveData.vramTotalGb != null && liveData.vramTotalGb > 0"
              class="tele-side-meta"
            >
              {{ fmtRamGb(liveData.vramUsedGb) }} / {{ fmtRamGb(liveData.vramTotalGb) }}
            </span>
          </div>
          <div class="tele-value" :style="{ color: usageColor(liveData.gpuUsage) }">
            {{ fmtPct(liveData.gpuUsage) }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: (liveData.gpuUsage ?? 0) + '%',
                background: usageColor(liveData.gpuUsage),
              }"
            ></div>
          </div>
          <div class="tele-sub-row">
            <span class="tele-sub" :style="{ color: tempColor(liveData.gpuTemp) }">
              {{ fmtTemp(liveData.gpuTemp) }} °C
            </span>
            <span v-if="liveData.gpuPowerWatts != null" class="tele-sub tele-muted">
              {{ liveData.gpuPowerWatts }} W
            </span>
          </div>
        </div>

        <div v-if="liveData.ramTotalGb != null" class="tele-card">
          <span class="tele-label">RAM</span>
          <div
            class="tele-value"
            :style="{ color: calcUsageColor(liveData.ramUsedGb, liveData.ramTotalGb) }"
          >
            {{ calcUsagePct(liveData.ramUsedGb, liveData.ramTotalGb) }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: calcUsagePct(liveData.ramUsedGb, liveData.ramTotalGb) + '%',
                background: calcUsageColor(liveData.ramUsedGb, liveData.ramTotalGb),
              }"
            ></div>
          </div>
          <span class="tele-sub">
            {{ fmtRamGb(liveData.ramUsedGb) }} / {{ fmtRamGb(liveData.ramTotalGb) }}
          </span>
        </div>

        <div v-if="liveData.swapTotalGb != null" class="tele-card">
          <span class="tele-label">Swap</span>
          <div
            class="tele-value"
            :style="{ color: calcUsageColor(liveData.swapUsedGb, liveData.swapTotalGb) }"
          >
            {{ calcUsagePct(liveData.swapUsedGb, liveData.swapTotalGb) }}%
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: calcUsagePct(liveData.swapUsedGb, liveData.swapTotalGb) + '%',
                background: calcUsageColor(liveData.swapUsedGb, liveData.swapTotalGb),
              }"
            ></div>
          </div>
          <span class="tele-sub">
            {{ fmtRamGb(liveData.swapUsedGb) }} / {{ fmtRamGb(liveData.swapTotalGb) }}
          </span>
        </div>

        <div class="tele-card">
          <span class="tele-label">Disco (I/O)</span>
          <div class="tele-io-values">
            <span
              ><span class="io-down">↓</span> {{ fmtMbps(liveData.diskReadMbps) }}
              <small>Mbps</small></span
            >
            <span
              ><span class="io-up">↑</span> {{ fmtMbps(liveData.diskWriteMbps) }}
              <small>Mbps</small></span
            >
          </div>
        </div>

        <div class="tele-card">
          <span class="tele-label">Rede</span>
          <div class="tele-io-values">
            <span
              ><span class="io-down">↓</span> {{ fmtMbps(liveData.downloadMbps) }}
              <small>Mbps</small></span
            >
            <span
              ><span class="io-up">↑</span> {{ fmtMbps(liveData.uploadMbps) }}
              <small>Mbps</small></span
            >
          </div>
        </div>

        <div v-if="liveData.moboTemperature != null" class="tele-card">
          <span class="tele-label">Placa-Mãe</span>
          <div class="tele-value" :style="{ color: tempColor(liveData.moboTemperature) }">
            {{ fmtTemp(liveData.moboTemperature) }} °C
          </div>
        </div>
      </div>
      <div v-else class="empty-state section-empty">
        Sem dados de telemetria disponíveis.
      </div>
    </CollapsibleSection>

    <CollapsibleSection
      v-if="showCharts"
      v-model:collapsed="chartsCollapsed"
      title="Gráficos"
    >
      <MachineIdleHistoryChart
        :machine-id="machineId"
        :active="!chartsCollapsed"
      />
    </CollapsibleSection>

    <CollapsibleSection
      v-if="machine.disks && machine.disks.length > 0"
      v-model:collapsed="disksCollapsed"
      title="Partições"
    >
      <div class="disk-table">
        <div class="disk-header">
          <span class="disk-col device-col">Dispositivo</span>
          <span class="disk-col mount-col">Montagem</span>
          <span class="disk-col fs-col">FS</span>
          <span class="disk-col free-col">Livre</span>
          <span class="disk-col size-col">Total</span>
          <span class="disk-col bar-col">Uso</span>
        </div>
        <div
          v-for="(d, i) in sortDisksBySize(machine.disks)"
          :key="diskPartitionKey(d, i)"
          class="disk-row-detail"
        >
          <span class="disk-col device-col">
            <code>{{ d.device }}</code>
          </span>
          <span class="disk-col mount-col">{{ d.mountpoint }}</span>
          <span class="disk-col fs-col">
            <span class="badge badge-info" style="font-size: 0.65rem">{{
              d.fstype || "--"
            }}</span>
          </span>
          <span
            class="disk-col free-col"
            :class="{
              'text-success': (d.freeGb ?? 0) > 50,
              'text-warning': (d.freeGb ?? 0) > 10 && (d.freeGb ?? 0) <= 50,
              'text-danger': (d.freeGb ?? 0) <= 10 && d.freeGb != null,
            }"
          >
            {{ fmtGb(d.freeGb) }}
          </span>
          <span class="disk-col size-col">{{ fmtGb(d.totalGb) }}</span>
          <span class="disk-col bar-col">
            <div class="disk-bar-track">
              <div
                class="disk-bar-fill"
                :style="{
                  width: diskUsedPct(d.totalGb, d.freeGb) + '%',
                  background:
                    diskUsedPct(d.totalGb, d.freeGb) > 90
                      ? 'var(--danger)'
                      : diskUsedPct(d.totalGb, d.freeGb) > 70
                        ? 'var(--warning)'
                        : 'var(--success)',
                }"
              ></div>
            </div>
            <span class="disk-pct-label">{{ diskUsedPct(d.totalGb, d.freeGb) }}%</span>
          </span>
        </div>
      </div>
    </CollapsibleSection>
  </div>
</template>

<style scoped>
.machine-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-bottom: 1rem;
}

.section-empty {
  padding: 1.5rem 0;
}

.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 1200px) {
  .telemetry-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.tele-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tele-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tele-value {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.1;
  transition: color 0.4s ease;
}

.telemetry-grid .progress-fill {
  transition: width 0.2s ease, background-color 0.2s ease;
}

.progress-fill {
  transition:
    width 0.5s ease,
    background 0.4s ease;
}

.tele-label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem;
}

.tele-side-meta {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.tele-sub-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.tele-sub {
  font-size: 0.82rem;
  margin-top: 0.15rem;
}

.tele-muted {
  color: var(--text-muted);
}

.tele-io-values {
  font-size: 1.1rem;
  line-height: 1.45;
  display: flex;
  flex-direction: column;
  justify-content: center;
  font-weight: 600;
}

.tele-io-values small {
  font-size: 0.65em;
  font-weight: 400;
  opacity: 0.7;
}

.io-down {
  color: var(--success);
}

.io-up {
  color: var(--info);
}

.disk-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-card);
}

.disk-header {
  display: flex;
  padding: 0.5rem 0.75rem;
  background: var(--bg-card-solid);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.disk-row-detail {
  display: flex;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  align-items: center;
  font-size: 0.82rem;
}

.disk-row-detail:last-child {
  border-bottom: none;
}

.disk-col {
  flex-shrink: 0;
}

.device-col {
  width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-col code {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.mount-col {
  width: 120px;
  font-weight: 500;
  color: var(--text-primary);
}

.fs-col {
  width: 70px;
}

.size-col {
  width: 80px;
  text-align: right;
  color: var(--text-secondary);
}

.free-col {
  width: 80px;
  text-align: right;
}

.bar-col {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 100px;
  padding-left: 0.75rem;
}

.disk-bar-track {
  flex: 1;
  height: 6px;
  background: var(--bg-input);
  border-radius: 3px;
  overflow: hidden;
}

.disk-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.disk-pct-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  min-width: 32px;
  text-align: right;
}
</style>
