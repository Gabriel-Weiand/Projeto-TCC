<script setup lang="ts">
import { ref, computed } from "vue";
import type { Machine, RealtimeTelemetry } from "@/types";
import {
  diskPartitionKey,
  diskUsedPct as diskUsedPctUtil,
  mergeDiskPartitionsWithTelemetry,
  partitionRoleLabel,
  sortDisksBySize,
} from "@/utils/machineDisks";
import CollapsibleSection from "@/components/CollapsibleSection.vue";
import MachineIdleHistoryChart from "@/components/MachineIdleHistoryChart.vue";
import MachineLiveProcessSection from "@/components/MachineLiveProcessSection.vue";
import type { TelemetryProcessSnapshot } from "@/types";

const props = withDefaults(
  defineProps<{
    machine: Machine;
    machineId: number;
    liveData: RealtimeTelemetry | null;
    /** Bloco CPU/GPU/RAM/rede em tempo real (somente admin). */
    showTelemetry?: boolean;
    /** Gráfico 24 h (somente admin). */
    showCharts?: boolean;
    /** Lista de processos do último lote (somente admin). */
    showProcesses?: boolean;
    latestProcesses?: TelemetryProcessSnapshot[] | null;
    latestProcessBatchTimestamp?: string | null;
  }>(),
  { showTelemetry: true, showCharts: false, showProcesses: false },
);

const displayDisks = computed(() =>
  mergeDiskPartitionsWithTelemetry(
    props.machine.disks ?? [],
    props.liveData?.disksInfo as Parameters<typeof mergeDiskPartitionsWithTelemetry>[1],
  ),
);

const telemetryCollapsed = ref(false);
const chartsCollapsed = ref(false);
const disksCollapsed = ref(false);

function usagePctWidth(
  used: number | null | undefined,
  total: number | null | undefined,
): number {
  if (used == null || total == null || total === 0) return 0;
  return (used / total) * 100;
}

function fmtPctDisplay(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${val.toFixed(1)}%`;
}

function fmtUsagePctFromPair(
  used: number | null | undefined,
  total: number | null | undefined,
): string {
  if (used == null || total == null || total === 0) return "—";
  return `${((used / total) * 100).toFixed(1)}%`;
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

function fmtTemp(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(1);
}

function fmtGb(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(1) + " GB";
}

function fmtRamPair(
  used: number | null | undefined,
  total: number | null | undefined,
): string | null {
  if (used == null && total == null) return null;
  const usedLabel = used != null ? `${used.toFixed(1)} GB` : "—";
  const totalLabel = total != null ? `${total.toFixed(1)} GB` : "—";
  return `${usedLabel} / ${totalLabel}`;
}

function fmtMbps(val: number | null | undefined): string {
  if (val == null) return "—";
  return Number(val).toFixed(1);
}

function fmtTempLine(val: number | null | undefined): string {
  if (val == null) return "— °C";
  return `${val.toFixed(1)} °C`;
}

function diskUsedPct(total: number | null, free: number | null, usagePct?: number | null): number {
  return diskUsedPctUtil(total, free, usagePct);
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
          <div class="tele-label-row">
            <span class="tele-label">CPU</span>
            <span
              v-if="liveData.moboTemperature != null"
              class="tele-side-meta mobo-meta"
              :style="{ color: tempColor(liveData.moboTemperature) }"
            >
              MOBO: {{ fmtTemp(liveData.moboTemperature) }} °C
            </span>
          </div>
          <div class="tele-value" :style="{ color: usageColor(liveData.cpuUsage) }">
            {{ fmtPctDisplay(liveData.cpuUsage) }}
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
              {{ fmtTempLine(liveData.cpuTemp) }}
            </span>
            <span v-if="liveData.cpuFreqMhz != null" class="tele-sub tele-muted">
              {{ liveData.cpuFreqMhz }} MHz
            </span>
          </div>
        </div>

        <div class="tele-card">
          <div class="tele-label-row">
            <span class="tele-label">GPU</span>
            <span
              v-if="
                liveData.vramTotalGb != null &&
                liveData.vramTotalGb > 0 &&
                liveData.vramUsedGb != null
              "
              class="tele-side-meta"
            >
              {{ liveData.vramUsedGb.toFixed(1) }} GB / {{ liveData.vramTotalGb.toFixed(1) }} GB
            </span>
          </div>
          <div class="tele-value" :style="{ color: usageColor(liveData.gpuUsage) }">
            {{ fmtPctDisplay(liveData.gpuUsage) }}
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
              {{ fmtTempLine(liveData.gpuTemp) }}
            </span>
            <span v-if="liveData.gpuPowerWatts != null" class="tele-sub tele-muted">
              {{ liveData.gpuPowerWatts }} W
            </span>
          </div>
        </div>

        <div class="tele-card">
          <span class="tele-label">RAM</span>
          <div
            class="tele-value"
            :style="{ color: calcUsageColor(liveData.ramUsedGb, liveData.ramTotalGb) }"
          >
            {{ fmtUsagePctFromPair(liveData.ramUsedGb, liveData.ramTotalGb) }}
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: usagePctWidth(liveData.ramUsedGb, liveData.ramTotalGb) + '%',
                background: calcUsageColor(liveData.ramUsedGb, liveData.ramTotalGb),
              }"
            ></div>
          </div>
          <span v-if="fmtRamPair(liveData.ramUsedGb, liveData.ramTotalGb)" class="tele-sub">
            {{ fmtRamPair(liveData.ramUsedGb, liveData.ramTotalGb) }}
          </span>
        </div>

        <div class="tele-card">
          <span class="tele-label">Swap</span>
          <div
            class="tele-value"
            :style="{ color: calcUsageColor(liveData.swapUsedGb, liveData.swapTotalGb) }"
          >
            {{ fmtUsagePctFromPair(liveData.swapUsedGb, liveData.swapTotalGb) }}
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: usagePctWidth(liveData.swapUsedGb, liveData.swapTotalGb) + '%',
                background: calcUsageColor(liveData.swapUsedGb, liveData.swapTotalGb),
              }"
            ></div>
          </div>
          <span v-if="fmtRamPair(liveData.swapUsedGb, liveData.swapTotalGb)" class="tele-sub">
            {{ fmtRamPair(liveData.swapUsedGb, liveData.swapTotalGb) }}
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

    <MachineLiveProcessSection
      v-if="showProcesses"
      :processes="latestProcesses ?? null"
      :batch-timestamp="latestProcessBatchTimestamp ?? null"
    />

    <CollapsibleSection
      v-if="displayDisks.length > 0"
      v-model:collapsed="disksCollapsed"
      title="Partições"
    >
      <div class="disk-table">
        <div class="disk-header">
          <span class="disk-col device-col">Dispositivo</span>
          <span class="disk-col mount-col">Montagem</span>
          <span class="disk-col fs-col">FS</span>
          <span class="disk-col role-col">Tipo</span>
          <span class="disk-col main-col">Principal</span>
          <span class="disk-col free-col">Livre</span>
          <span class="disk-col size-col">Total</span>
          <span class="disk-col bar-col">Uso</span>
        </div>
        <div
          v-for="(d, i) in sortDisksBySize(displayDisks)"
          :key="diskPartitionKey(d, i)"
          class="disk-row-detail"
        >
          <span class="disk-col device-col">
            <code>{{ d.device }}</code>
          </span>
          <span class="disk-col mount-col">{{ d.mountpoint }}</span>
          <span class="disk-col fs-col">
            <span class="badge badge-info" style="font-size: 0.65rem">{{
              d.fstype || "—"
            }}</span>
          </span>
          <span class="disk-col role-col">
            <span
              class="badge"
              :class="d.role === 'system' ? 'badge-muted' : 'badge-success'"
              style="font-size: 0.65rem"
            >
              {{ partitionRoleLabel(d.role) }}
            </span>
          </span>
          <span class="disk-col main-col">
            <span v-if="d.mainDisk" class="badge badge-info" style="font-size: 0.65rem">
              Sim
            </span>
            <span v-else class="text-muted">—</span>
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
                  width: diskUsedPct(d.totalGb, d.freeGb, d.usagePct) + '%',
                  background:
                    diskUsedPct(d.totalGb, d.freeGb, d.usagePct) > 90
                      ? 'var(--danger)'
                      : diskUsedPct(d.totalGb, d.freeGb, d.usagePct) > 70
                        ? 'var(--warning)'
                        : 'var(--success)',
                }"
              ></div>
            </div>
            <span class="disk-pct-label">{{ diskUsedPct(d.totalGb, d.freeGb, d.usagePct) }}%</span>
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

.mobo-meta {
  text-transform: none;
  letter-spacing: normal;
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
  overflow-x: auto;
  background: var(--bg-card);
}

.disk-header,
.disk-row-detail {
  display: grid;
  grid-template-columns:
    minmax(9rem, 1.45fr)
    minmax(4.75rem, 0.9fr)
    minmax(3.5rem, 0.6fr)
    minmax(4.5rem, 0.72fr)
    minmax(4.25rem, 0.68fr)
    minmax(5rem, 0.85fr)
    minmax(5rem, 0.85fr)
    minmax(12.75rem, 1.05fr);
  gap: 0.55rem;
  padding: 0.55rem 0.85rem;
  align-items: center;
}

.disk-header {
  background: var(--bg-card-solid);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  text-align: center;
}

.disk-row-detail {
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.82rem;
  text-align: center;
}

.disk-row-detail:last-child {
  border-bottom: none;
}

.disk-col {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.device-col {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-col code {
  font-size: 0.72rem;
  color: var(--text-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mount-col {
  font-weight: 500;
  color: var(--text-primary);
}

.size-col {
  color: var(--text-secondary);
}

.bar-col {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-width: 0;
  width: 100%;
}

.disk-bar-track {
  flex: 1 1 156px;
  max-width: 156px;
  min-width: 0;
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
  min-width: 2.25rem;
  text-align: center;
}
</style>
