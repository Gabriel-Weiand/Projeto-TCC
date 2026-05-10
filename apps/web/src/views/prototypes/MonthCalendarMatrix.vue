<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { Allocation } from "@/types";

const machinesStore = useMachinesStore();

// ---- Month navigation ----
const todayRef = new Date();
todayRef.setHours(0, 0, 0, 0);

const monthOffset = ref(0);

const currentMonthDate = computed(() => {
  const d = new Date(todayRef);
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset.value);
  return d;
});

const daysInMonth = computed(() =>
  new Date(
    currentMonthDate.value.getFullYear(),
    currentMonthDate.value.getMonth() + 1,
    0,
  ).getDate(),
);

const monthDays = computed(() => {
  const days: Date[] = [];
  for (let i = 1; i <= daysInMonth.value; i++) {
    days.push(
      new Date(
        currentMonthDate.value.getFullYear(),
        currentMonthDate.value.getMonth(),
        i,
      ),
    );
  }
  return days;
});

function monthLabel(d: Date) {
  return d
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^\w/, (c) => c.toUpperCase());
}

function isToday(d: Date) {
  return (
    d.getFullYear() === todayRef.getFullYear() &&
    d.getMonth() === todayRef.getMonth() &&
    d.getDate() === todayRef.getDate()
  );
}

function isWeekend(d: Date) {
  return d.getDay() === 0 || d.getDay() === 6;
}

const DAY_NAMES_SHORT = ["D", "S", "T", "Q", "Q", "S", "S"];

// ---- Data ----
const loading = ref(true);
const allocations = ref<Allocation[]>([]);

async function loadData() {
  loading.value = true;
  try {
    if (!machinesStore.machines.length) await machinesStore.fetchMachines();
    const results = await Promise.all(
      machinesStore.machines.map((m) =>
        machinesStore.fetchMachineAllocations(m.id, { limit: 500 }),
      ),
    );
    allocations.value = results.flatMap((r) => r.data ?? []);
  } finally {
    loading.value = false;
  }
}

// ---- Cell state per (machine, day) ----
type CellStatus = "free" | "approved" | "pending" | "finished" | "mixed";

interface CellInfo {
  status: CellStatus;
  allocations: Allocation[];
  occupancyPct: number; // 0-100 how much of the day is occupied
}

function cellInfo(machineId: number, day: Date): CellInfo {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  const dayMs = 24 * 60 * 60 * 1000;

  const relevant = allocations.value.filter(
    (a) =>
      a.machineId === machineId &&
      ["approved", "pending", "finished"].includes(a.status) &&
      new Date(a.startTime) <= dayEnd &&
      new Date(a.endTime) >= dayStart,
  );

  if (relevant.length === 0) return { status: "free", allocations: [], occupancyPct: 0 };

  // Compute total occupied ms (clamped)
  let occupiedMs = 0;
  for (const a of relevant) {
    const s = Math.max(new Date(a.startTime).getTime(), dayStart.getTime());
    const e = Math.min(new Date(a.endTime).getTime(), dayEnd.getTime());
    occupiedMs += Math.max(0, e - s);
  }
  const occupancyPct = Math.min(100, (occupiedMs / dayMs) * 100);

  const statuses = new Set(relevant.map((a) => a.status));
  let status: CellStatus = "free";
  if (statuses.has("approved") && statuses.has("pending")) status = "mixed";
  else if (statuses.has("approved")) status = "approved";
  else if (statuses.has("pending")) status = "pending";
  else if (statuses.has("finished")) status = "finished";

  return { status, allocations: relevant, occupancyPct };
}

// ---- Tooltip for a cell ----
function cellTooltip(machineId: number, day: Date): string {
  const info = cellInfo(machineId, day);
  if (info.status === "free") {
    const machine = machinesStore.machines.find((m) => m.id === machineId);
    return `${machine?.name ?? "#" + machineId} — Livre`;
  }
  return info.allocations
    .map((a) => {
      const user = a.user?.fullName ?? "Usuário";
      const s = new Date(a.startTime);
      const e = new Date(a.endTime);
      const fmtDate = (d: Date) =>
        d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const fmtTime = (d: Date) =>
        d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const multiDay = s.toDateString() !== e.toDateString();
      const range = multiDay
        ? `${fmtDate(s)} → ${fmtDate(e)}`
        : `${fmtTime(s)} – ${fmtTime(e)}`;
      const statusMap: Record<string, string> = {
        approved: "Aprovada",
        pending: "Pendente",
        finished: "Finalizada",
      };
      return `${user} · ${range}\n${a.reason ?? ""} [${statusMap[a.status] ?? a.status}]`;
    })
    .join("\n\n");
}

// ---- Selected cell for detail popover ----
interface SelectedCell {
  machineId: number;
  day: Date;
  info: CellInfo;
}

const selectedCell = ref<SelectedCell | null>(null);

function selectCell(machineId: number, day: Date) {
  const info = cellInfo(machineId, day);
  if (
    selectedCell.value &&
    selectedCell.value.machineId === machineId &&
    selectedCell.value.day.toDateString() === day.toDateString()
  ) {
    selectedCell.value = null;
    return;
  }
  selectedCell.value = { machineId, day, info };
}

// ---- Color for cell status + occupancy ----
function cellStyle(machineId: number, day: Date) {
  const info = cellInfo(machineId, day);
  const isSelected =
    selectedCell.value?.machineId === machineId &&
    selectedCell.value?.day.toDateString() === day.toDateString();

  if (info.status === "free") {
    return {
      background: isToday(day)
        ? "rgba(124,108,240,0.06)"
        : isWeekend(day)
          ? "rgba(255,255,255,0.012)"
          : "transparent",
      outline: isSelected ? "1.5px solid var(--accent)" : "none",
    };
  }

  const alpha = 0.12 + (info.occupancyPct / 100) * 0.45;
  const colors: Record<CellStatus, { bg: string; glow: string }> = {
    free: { bg: "transparent", glow: "transparent" },
    approved: {
      bg: `rgba(102,126,234,${alpha})`,
      glow: `rgba(102,126,234,0.4)`,
    },
    pending: {
      bg: `rgba(251,191,36,${alpha * 0.9})`,
      glow: `rgba(251,191,36,0.3)`,
    },
    finished: {
      bg: `rgba(255,255,255,${alpha * 0.4})`,
      glow: "transparent",
    },
    mixed: {
      bg: `rgba(155,109,255,${alpha})`,
      glow: `rgba(155,109,255,0.35)`,
    },
  };

  const c = colors[info.status];
  return {
    background: c.bg,
    boxShadow: isSelected ? `inset 0 0 0 1.5px var(--accent)` : "none",
    outline: "none",
  };
}

function cellClass(machineId: number, day: Date) {
  const info = cellInfo(machineId, day);
  return {
    "cell-free": info.status === "free",
    "cell-approved": info.status === "approved",
    "cell-pending": info.status === "pending",
    "cell-finished": info.status === "finished",
    "cell-mixed": info.status === "mixed",
    "cell-today": isToday(day),
    "cell-weekend": isWeekend(day),
    "cell-selected":
      selectedCell.value?.machineId === machineId &&
      selectedCell.value?.day.toDateString() === day.toDateString(),
  };
}

// ---- Occupancy stats for summary row ----
function machineMonthOccupancy(machineId: number): number {
  const occupied = monthDays.value.filter(
    (d) => cellInfo(machineId, d).status !== "free",
  ).length;
  return Math.round((occupied / daysInMonth.value) * 100);
}

// ---- Detail popover content ----
function popoverTitle(cell: SelectedCell) {
  const machine = machinesStore.machines.find(
    (m) => m.id === cell.machineId,
  );
  return `${machine?.name ?? "#" + cell.machineId} — ${cell.day.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`;
}

function fmtDateRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const multiDay = s.toDateString() !== e.toDateString();
  if (multiDay) {
    const days = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return `${fmtDate(s)} → ${fmtDate(e)} · ${days}d`;
  }
  return `${fmtTime(s)} – ${fmtTime(e)}`;
}

function statusBadge(s: string) {
  return (
    {
      approved: "badge-success",
      pending: "badge-warning",
      finished: "badge-info",
    }[s] ?? "badge-muted"
  );
}

function statusLabel(s: string) {
  return (
    { approved: "Aprovada", pending: "Pendente", finished: "Finalizada" }[s] ??
    s
  );
}

// ---- Machine status badge ----
function machineStatusBadge(s: string) {
  return (
    { available: "badge-success", occupied: "badge-warning", maintenance: "badge-info", offline: "badge-danger" }[s] ??
    "badge-muted"
  );
}

function machineStatusLabel(s: string) {
  return (
    { available: "Disponível", occupied: "Ocupada", maintenance: "Manutenção", offline: "Offline" }[s] ?? s
  );
}

onMounted(loadData);
</script>

<template>
  <div class="fade-in proto-wrap">
    <div class="proto-banner">
      <span class="proto-tag">PROTÓTIPO C</span>
      Mapa de Disponibilidade — Heatmap máquinas × dias
    </div>

    <div class="page-header">
      <h1 class="page-title">Calendário de Alocações — Mapa de Disponibilidade</h1>
    </div>

    <div v-if="loading" class="empty-state">Carregando dados...</div>

    <template v-else>
      <!-- Month nav -->
      <div class="cal-toolbar">
        <div class="cal-nav">
          <button class="btn btn-ghost btn-sm" @click="monthOffset--">←</button>
          <span class="cal-month-label">{{ monthLabel(currentMonthDate) }}</span>
          <button class="btn btn-ghost btn-sm" @click="monthOffset++">→</button>
          <button
            v-if="monthOffset !== 0"
            class="btn btn-ghost btn-sm"
            @click="monthOffset = 0"
          >
            Hoje
          </button>
        </div>
        <!-- Occupancy legend scale -->
        <div class="occupancy-legend">
          <span class="occ-label">Ocupação:</span>
          <div class="occ-scale">
            <span class="occ-swatch" style="background:rgba(102,126,234,0.12)"></span>
            <span class="occ-swatch" style="background:rgba(102,126,234,0.28)"></span>
            <span class="occ-swatch" style="background:rgba(102,126,234,0.45)"></span>
            <span class="occ-swatch" style="background:rgba(102,126,234,0.57)"></span>
          </div>
          <span class="occ-label">Baixa → Alta</span>
          <div class="occ-scale" style="margin-left:0.75rem">
            <span class="occ-swatch" style="background:rgba(251,191,36,0.35);border-style:dashed"></span>
            <span class="occ-text">Pendente</span>
            <span class="occ-swatch" style="background:rgba(255,255,255,0.08);margin-left:0.5rem"></span>
            <span class="occ-text">Finalizada</span>
          </div>
        </div>
      </div>

      <div class="matrix-layout" :class="{ 'with-panel': selectedCell }">
        <!-- Matrix table -->
        <div class="matrix-outer">
          <div class="matrix-scroll">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th class="machine-th">Máquina</th>
                  <th
                    v-for="day in monthDays"
                    :key="day.getDate()"
                    class="day-th"
                    :class="{ today: isToday(day), weekend: isWeekend(day) }"
                  >
                    <div class="day-th-inner">
                      <span class="day-th-num">{{ day.getDate() }}</span>
                      <span class="day-th-name">{{ DAY_NAMES_SHORT[day.getDay()] }}</span>
                    </div>
                  </th>
                  <th class="occ-th">Ocupação</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="machine in machinesStore.machines"
                  :key="machine.id"
                >
                  <td class="machine-td">
                    <div class="machine-td-inner">
                      <span class="machine-td-name">{{ machine.name }}</span>
                      <span
                        :class="['badge', machineStatusBadge(machine.status)]"
                        style="font-size:0.62rem"
                      >
                        {{ machineStatusLabel(machine.status) }}
                      </span>
                    </div>
                  </td>
                  <td
                    v-for="day in monthDays"
                    :key="day.getDate()"
                    class="matrix-cell"
                    :class="cellClass(machine.id, day)"
                    :style="cellStyle(machine.id, day)"
                    :title="cellTooltip(machine.id, day)"
                    @click="selectCell(machine.id, day)"
                  >
                    <div
                      v-if="cellInfo(machine.id, day).status !== 'free'"
                      class="cell-fill"
                      :style="{
                        height: cellInfo(machine.id, day).occupancyPct + '%',
                      }"
                    ></div>
                  </td>
                  <td class="occ-stat-td">
                    <div class="occ-bar-wrap">
                      <div class="occ-bar">
                        <div
                          class="occ-bar-fill"
                          :style="{ width: machineMonthOccupancy(machine.id) + '%' }"
                        ></div>
                      </div>
                      <span class="occ-pct">{{ machineMonthOccupancy(machine.id) }}%</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Detail popover panel -->
        <aside v-if="selectedCell" class="detail-panel fade-in">
          <div class="panel-card">
            <div class="panel-header">
              <h2 class="panel-title">{{ popoverTitle(selectedCell) }}</h2>
              <button class="btn-close" @click="selectedCell = null">✕</button>
            </div>
            <div class="panel-body">
              <div
                v-if="selectedCell.info.allocations.length === 0"
                class="empty-state"
                style="padding:1.5rem 0"
              >
                Máquina disponível neste dia.
              </div>
              <div
                v-for="(a, i) in selectedCell.info.allocations"
                :key="i"
                class="alloc-detail-card"
              >
                <div class="alloc-detail-header">
                  <span class="alloc-user">{{ a.user?.fullName ?? "Usuário" }}</span>
                  <span :class="['badge', statusBadge(a.status)]">
                    {{ statusLabel(a.status) }}
                  </span>
                </div>
                <div class="alloc-range">
                  {{ fmtDateRange(a.startTime, a.endTime) }}
                </div>
                <div v-if="a.reason" class="alloc-reason">{{ a.reason }}</div>
              </div>

              <!-- Occupancy bar for the day -->
              <div class="day-occ-summary">
                <span class="day-occ-label">Ocupação do dia</span>
                <div class="occ-bar" style="height:8px">
                  <div
                    class="occ-bar-fill"
                    :style="{ width: selectedCell.info.occupancyPct + '%' }"
                  ></div>
                </div>
                <span class="day-occ-pct">{{ Math.round(selectedCell.info.occupancyPct) }}%</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <p class="hint-text">
        💡 Clique em uma célula para ver os detalhes. A intensidade da cor representa o tempo de ocupação no dia.
      </p>
    </template>
  </div>
</template>

<style scoped>
.proto-wrap { max-width: 100%; }

.proto-banner {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--accent-soft);
  border: 1px solid rgba(124, 108, 240, 0.25);
  border-radius: var(--radius);
  padding: 0.4rem 1rem;
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

.proto-tag {
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
}

/* ---- Toolbar ---- */
.cal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.cal-nav { display: flex; align-items: center; gap: 0.5rem; }
.cal-month-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 200px;
  text-align: center;
}

/* ---- Occupancy legend ---- */
.occupancy-legend {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.occ-label { font-size: 0.75rem; color: var(--text-muted); }
.occ-scale { display: flex; gap: 2px; align-items: center; }
.occ-swatch {
  width: 16px;
  height: 14px;
  border-radius: 2px;
  border: 1px solid rgba(255,255,255,0.08);
}
.occ-text { font-size: 0.72rem; color: var(--text-muted); }

/* ---- Matrix layout ---- */
.matrix-layout {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}
.matrix-layout.with-panel .matrix-outer { flex: 1; min-width: 0; }
.matrix-outer { width: 100%; }

.matrix-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}

/* ---- Table ---- */
.matrix-table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
}

/* ---- Machine header TH ---- */
.machine-th {
  text-align: left;
  padding: 0.6rem 1rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  background: rgba(255,255,255,0.015);
  position: sticky;
  left: 0;
  z-index: 3;
  min-width: 160px;
}

.occ-th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  background: rgba(255,255,255,0.015);
  min-width: 100px;
}

/* ---- Day header TH ---- */
.day-th {
  padding: 0;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border-subtle);
  background: rgba(255,255,255,0.015);
  min-width: 28px;
  width: 28px;
}
.day-th:last-of-type { border-right: none; }
.day-th.today { background: rgba(124,108,240,0.08); }
.day-th.weekend { background: rgba(255,255,255,0.02); }

.day-th-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0;
  gap: 1px;
}
.day-th-num {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1;
}
.day-th-name {
  font-size: 0.56rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
}
.day-th.today .day-th-num { color: var(--accent); }
.day-th.today .day-th-name { color: var(--accent); }

/* ---- Machine TD ---- */
.machine-td {
  position: sticky;
  left: 0;
  background: var(--bg-card-solid);
  z-index: 2;
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border);
  padding: 0.5rem 1rem;
}

.machine-td-inner {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.machine-td-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

/* ---- Matrix cells ---- */
.matrix-cell {
  width: 28px;
  height: 42px;
  padding: 2px;
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
  cursor: pointer;
  position: relative;
  transition: filter var(--transition);
  vertical-align: bottom;
}
.matrix-cell:last-of-type { border-right: none; }
.matrix-cell:hover { filter: brightness(1.4); }
.matrix-cell.cell-today { box-shadow: inset 0 0 0 1px rgba(124,108,240,0.4); }
.matrix-cell.cell-selected { box-shadow: inset 0 0 0 1.5px var(--accent) !important; filter: brightness(1.2); }
.matrix-cell.cell-free:not(.cell-weekend) { background: transparent; }
.matrix-cell.cell-weekend { background: rgba(255,255,255,0.012); }
.matrix-cell.cell-pending { border-right-style: dashed; }

/* Fill indicator bar from bottom */
.cell-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  min-height: 2px;
  border-radius: 1px 1px 0 0;
  background: rgba(255,255,255,0.12);
  pointer-events: none;
}
.cell-approved .cell-fill { background: rgba(255,255,255,0.15); }
.cell-pending .cell-fill { background: rgba(251,191,36,0.2); }

/* ---- Occupancy stat column ---- */
.occ-stat-td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  min-width: 100px;
}
.occ-bar-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.occ-bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.06);
  overflow: hidden;
}
.occ-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--gradient-accent);
  transition: width 0.5s ease;
}
.occ-pct {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-feature-settings: "tnum";
  min-width: 30px;
}

/* ---- Detail panel ---- */
.detail-panel { width: 300px; flex-shrink: 0; }

.panel-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-elevated);
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
}
.panel-title { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
.panel-body { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }

/* ---- Allocation detail card ---- */
.alloc-detail-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.alloc-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.alloc-user { font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
.alloc-range { font-size: 0.78rem; color: var(--text-muted); font-feature-settings: "tnum"; }
.alloc-reason { font-size: 0.78rem; color: var(--text-secondary); font-style: italic; }

.day-occ-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-top: 0.25rem;
  border-top: 1px solid var(--border-subtle);
}
.day-occ-label { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }
.day-occ-pct { font-size: 0.75rem; color: var(--text-secondary); min-width: 34px; text-align: right; }

/* ---- Hint ---- */
.hint-text {
  margin-top: 0.75rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .matrix-layout { flex-direction: column; }
  .detail-panel { width: 100%; }
}
</style>
