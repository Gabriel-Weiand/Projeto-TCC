<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import { useAuthStore } from "@/stores/auth";
import type { Allocation } from "@/types";

const machinesStore = useMachinesStore();
const authStore = useAuthStore();

const currentUserId = computed(() => authStore.user?.id ?? null);

// ---- Machine viewport: 8 visible at a time, snap scroll ----
const PAGE_SIZE = 8;
const machineOffset = ref(0);

const maxOffset = computed(() =>
  Math.max(0, machinesStore.machines.length - PAGE_SIZE)
);

const displayedMachines = computed(() =>
  machinesStore.machines.slice(machineOffset.value, machineOffset.value + PAGE_SIZE)
);

function scrollMachines(delta: number) {
  machineOffset.value = Math.max(
    0,
    Math.min(maxOffset.value, machineOffset.value + delta)
  );
}

// Mouse wheel handler for the left (label) column
const ganttLeftEl = ref<HTMLElement | null>(null);
function onLeftWheel(e: WheelEvent) {
  e.preventDefault();
  if (e.deltaY > 0) scrollMachines(1);
  else if (e.deltaY < 0) scrollMachines(-1);
}

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

const DAY_NAMES = ["D", "S", "T", "Q", "Q", "S", "S"];

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

// ---- Color palette (one color per machine slot) ----
const PALETTE = [
  { bg: "rgba(102,126,234,0.30)", border: "#667eea", text: "#a5b4fc" },
  { bg: "rgba(52,211,153,0.25)", border: "#34d399", text: "#6ee7b7" },
  { bg: "rgba(251,191,36,0.25)", border: "#fbbf24", text: "#fcd34d" },
  { bg: "rgba(96,165,250,0.25)", border: "#60a5fa", text: "#93c5fd" },
  { bg: "rgba(248,113,113,0.25)", border: "#f87171", text: "#fca5a5" },
  { bg: "rgba(192,132,252,0.25)", border: "#c084fc", text: "#e9d5ff" },
  { bg: "rgba(45,212,191,0.25)", border: "#2dd4bf", text: "#99f6e4" },
  { bg: "rgba(251,146,60,0.25)", border: "#fb923c", text: "#fed7aa" },
];

function machineColor(machineId: number) {
  const idx = machinesStore.machines.findIndex((m) => m.id === machineId);
  return PALETTE[(idx >= 0 ? idx : 0) % PALETTE.length];
}

// ---- Gantt bars ----
const CELL_W = 42; // px per day column

function barsForMachine(machineId: number) {
  const monthStart = new Date(
    currentMonthDate.value.getFullYear(),
    currentMonthDate.value.getMonth(),
    1,
    0, 0, 0, 0,
  );
  const monthEnd = new Date(
    currentMonthDate.value.getFullYear(),
    currentMonthDate.value.getMonth() + 1,
    0, 23, 59, 59, 999,
  );
  const totalMs = monthEnd.getTime() - monthStart.getTime() + 1;
  const totalPx = daysInMonth.value * CELL_W;

  return allocations.value
    .filter(
      (a) =>
        a.machineId === machineId &&
        ["approved", "pending", "finished"].includes(a.status) &&
        new Date(a.startTime) <= monthEnd &&
        new Date(a.endTime) >= monthStart,
    )
    .map((a) => {
      const s = new Date(a.startTime);
      const e = new Date(a.endTime);
      const cs = s < monthStart ? monthStart : s;
      const ce = e > monthEnd ? monthEnd : e;

      const leftPx = ((cs.getTime() - monthStart.getTime()) / totalMs) * totalPx;
      const widthPx = Math.max(
        CELL_W * 0.85,
        ((ce.getTime() - cs.getTime()) / totalMs) * totalPx,
      );

      const color = machineColor(machineId);
      return {
        allocation: a,
        leftPx: Math.max(0, leftPx),
        widthPx,
        color,
        isPending: a.status === "pending",
        isFinished: a.status === "finished",
        // a.isOwn: flag enviada pela API para não-admins (userId anonimizado)
        // a.userId: disponível para admins que recebem dados completos
        isOwn: a.isOwn === true ||
          (currentUserId.value !== null && a.userId === currentUserId.value),
        tooltip: buildTooltip(a),
      };
    })
    .sort((a, b) => a.leftPx - b.leftPx);
}

function buildTooltip(a: Allocation) {
  const s = new Date(a.startTime);
  const e = new Date(a.endTime);
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const multiDay = s.toDateString() !== e.toDateString();
  const durationDays = Math.ceil(
    (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24),
  );
  const range = multiDay
    ? `${fmtDate(s)} → ${fmtDate(e)} (${durationDays}d)`
    : `${fmtDate(s)} ${fmtTime(s)} – ${fmtTime(e)}`;
  const user = a.user?.fullName ?? "Usuário";
  const statusMap: Record<string, string> = {
    approved: "Aprovada",
    pending: "Pendente",
    finished: "Finalizada",
  };
  const status = statusMap[a.status] ?? a.status;
  const own = a.isOwn === true || (currentUserId.value !== null && a.userId === currentUserId.value);
  const ownMark = own ? " (você)" : "";
  return `${user}${ownMark}\n${range}\n${a.reason ?? ""}\n[${status}]`;
}

function statusBadge(s: string) {
  return (
    {
      available: "badge-success",
      occupied: "badge-warning",
      maintenance: "badge-info",
      offline: "badge-danger",
    }[s] ?? "badge-muted"
  );
}

function statusLabel(s: string) {
  return (
    { available: "Disponível", occupied: "Ocupada", maintenance: "Manutenção", offline: "Offline" }[s] ?? s
  );
}

// ---- Today x position ----
const todayBarLeft = computed(() => {
  const monthStart = new Date(
    currentMonthDate.value.getFullYear(),
    currentMonthDate.value.getMonth(),
    1,
  );
  const monthEnd = new Date(
    currentMonthDate.value.getFullYear(),
    currentMonthDate.value.getMonth() + 1,
    0,
  );
  if (todayRef < monthStart || todayRef > monthEnd) return null;
  return (todayRef.getDate() - 1) * CELL_W + CELL_W / 2;
});

onMounted(loadData);
</script>

<template>
  <div class="fade-in proto-wrap">
    <div class="proto-banner">
      <span class="proto-tag">PROTÓTIPO A</span>
      Gantt Timeline — Ocupação mensal por máquina
    </div>

    <div class="page-header">
      <h1 class="page-title">Calendário de Alocações — Gantt</h1>
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

        <!-- Machine scroll indicator -->
        <div class="machine-scroll-info">
          <button class="scroll-arrow" :disabled="machineOffset === 0" @click="scrollMachines(-1)">▲</button>
          <span class="scroll-label">
            {{ machineOffset + 1 }}–{{ Math.min(machineOffset + PAGE_SIZE, machinesStore.machines.length) }}
            <span class="scroll-total">de {{ machinesStore.machines.length }}</span>
          </span>
          <button class="scroll-arrow" :disabled="machineOffset >= maxOffset" @click="scrollMachines(1)">▼</button>
        </div>

        <div class="legend">
          <span class="leg-item"><span class="leg-dot own"></span>Sua alocação</span>
          <span class="leg-item"><span class="leg-dot approved"></span>Aprovada</span>
          <span class="leg-item"><span class="leg-dot pending"></span>Pendente</span>
          <span class="leg-item"><span class="leg-dot finished"></span>Finalizada</span>
          <span class="leg-item"><span class="leg-dot today-dot"></span>Hoje</span>
        </div>
      </div>

      <!-- Gantt chart -->
      <div class="gantt-wrap">
        <!-- Fixed left: machine labels -->
        <div class="gantt-left" ref="ganttLeftEl" @wheel="onLeftWheel">
          <div class="gantt-left-header">
            Máquina
          </div>
          <div
            v-for="machine in displayedMachines"
            :key="machine.id"
            class="gantt-machine-label"
          >
            <span class="machine-name">{{ machine.name }}</span>
            <span :class="['badge', statusBadge(machine.status)]" style="font-size:0.65rem">
              {{ statusLabel(machine.status) }}
            </span>
          </div>
        </div>

        <!-- Scrollable right: timeline -->
        <div class="gantt-right" tabindex="-1">
          <!-- Day headers -->
          <div class="gantt-days-header" :style="{ width: daysInMonth * CELL_W + 'px' }">
            <div
              v-for="day in monthDays"
              :key="day.getDate()"
              class="gantt-day-cell header"
              :class="{ today: isToday(day), weekend: isWeekend(day) }"
              :style="{ width: CELL_W + 'px' }"
            >
              <span class="d-num">{{ day.getDate() }}</span>
              <span class="d-name">{{ DAY_NAMES[day.getDay()] }}</span>
            </div>
          </div>

          <!-- Machine rows -->
          <div
            v-for="machine in displayedMachines"
            :key="machine.id"
            class="gantt-track-row"
          >
            <div
              class="gantt-track"
              :style="{ width: daysInMonth * CELL_W + 'px' }"
            >
              <!-- Background grid cells -->
              <div
                v-for="day in monthDays"
                :key="day.getDate()"
                class="gantt-day-cell body"
                :class="{ today: isToday(day), weekend: isWeekend(day) }"
                :style="{ width: CELL_W + 'px' }"
              ></div>

              <!-- Today vertical line -->
              <div
                v-if="todayBarLeft !== null"
                class="today-line"
                :style="{ left: todayBarLeft + 'px' }"
              ></div>

              <!-- Allocation bars -->
              <div
                v-for="(bar, bi) in barsForMachine(machine.id)"
                :key="bi"
                class="gantt-bar"
                :class="{ pending: bar.isPending, finished: bar.isFinished, own: bar.isOwn }"
                :style="{
                  left: bar.leftPx + 'px',
                  width: bar.widthPx + 'px',
                  '--bar-bg': bar.color.bg,
                  '--bar-border': bar.color.border,
                  '--bar-text': bar.color.text,
                }"
                :title="bar.tooltip"
              >
                <span class="bar-label">{{
                  bar.allocation.user?.fullName ?? "Reserva"
                }}{{ bar.isOwn ? " ✦" : "" }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p class="hint-text">
        💡 Passe o mouse sobre as barras para ver detalhes. Role horizontalmente para navegar pelo mês.
      </p>
    </template>
  </div>
</template>

<style scoped>
/* ---- Prototype banner ---- */
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

.cal-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cal-month-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 200px;
  text-align: center;
}

.legend {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.leg-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.leg-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
.leg-dot.approved { background: rgba(102, 126, 234, 0.6); border: 1.5px solid #667eea; }
.leg-dot.pending { background: rgba(251, 191, 36, 0.5); border: 1.5px solid #fbbf24; }
.leg-dot.finished { background: rgba(255,255,255,0.08); border: 1.5px solid rgba(255,255,255,0.25); }
.leg-dot.today-dot { background: var(--accent); border-radius: 50%; }
.leg-dot.own {
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid #fff;
  box-shadow: 0 0 6px rgba(255,255,255,0.6);
}

/* Machine scroll controls */
.machine-scroll-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.scroll-arrow {
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.7rem;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  user-select: none;
}
.scroll-arrow:hover:not(:disabled) {
  border-color: rgba(124, 108, 240, 0.5);
  background: rgba(124, 108, 240, 0.1);
}
.scroll-arrow:disabled {
  opacity: 0.3;
  cursor: default;
}
.scroll-label {
  font-size: 0.78rem;
  color: var(--text-primary);
  white-space: nowrap;
  min-width: 72px;
  text-align: center;
}
.scroll-total {
  color: var(--text-muted);
  font-size: 0.73rem;
}

/* ---- Gantt layout ---- */
.gantt-wrap {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.gantt-left {
  flex-shrink: 0;
  width: 190px;
  border-right: 1px solid var(--border);
}

.gantt-left-header {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.015);
}

.gantt-machine-label {
  height: 52px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.25rem;
  padding: 0 1rem;
  border-bottom: 1px solid var(--border-subtle);
}
.gantt-machine-label:last-child { border-bottom: none; }

.machine-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.gantt-right {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}

/* ---- Day headers ---- */
.gantt-days-header {
  display: flex;
  height: 48px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.015);
}

.gantt-day-cell {
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
}
.gantt-day-cell:last-child { border-right: none; }

.gantt-day-cell.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
}

.d-num {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1;
}

.d-name {
  font-size: 0.6rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
}

.gantt-day-cell.today .d-num { color: var(--accent); }
.gantt-day-cell.today .d-name { color: var(--accent); }
.gantt-day-cell.weekend { background: rgba(255, 255, 255, 0.012); }
.gantt-day-cell.today { background: rgba(124, 108, 240, 0.06); }

/* ---- Track rows ---- */
.gantt-track-row {
  border-bottom: 1px solid var(--border-subtle);
}
.gantt-track-row:last-child { border-bottom: none; }

.gantt-track {
  position: relative;
  height: 52px;
  display: flex;
}

.gantt-day-cell.body {
  height: 100%;
  border-right: 1px solid var(--border-subtle);
}
.gantt-day-cell.body.weekend { background: rgba(255, 255, 255, 0.012); }
.gantt-day-cell.body.today { background: rgba(124, 108, 240, 0.05); }

/* ---- Today vertical line ---- */
.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
  opacity: 0.6;
  z-index: 3;
  pointer-events: none;
  transform: translateX(-50%);
}

/* ---- Allocation bars ---- */
.gantt-bar {
  position: absolute;
  top: 8px;
  height: 36px;
  background: var(--bar-bg);
  border-left: 3px solid var(--bar-border);
  border-radius: 0 5px 5px 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
  cursor: default;
  z-index: 2;
  transition: filter var(--transition), transform var(--transition);
  overflow: hidden;
  min-width: 4px;
}

.gantt-bar:hover {
  filter: brightness(1.3);
  transform: scaleY(1.06);
  z-index: 4;
}

.gantt-bar.pending {
  --bar-bg: rgba(251, 191, 36, 0.20);
  --bar-border: #fbbf24;
  --bar-text: #fcd34d;
  border-style: dashed;
}

.gantt-bar.finished {
  --bar-bg: rgba(255,255,255,0.05);
  --bar-border: rgba(255,255,255,0.2);
  --bar-text: var(--text-muted);
}

.gantt-bar.own {
  box-shadow: 0 0 0 1.5px rgba(255,255,255,0.55), 0 0 10px rgba(124,108,240,0.45);
  z-index: 3;
}
.gantt-bar.own .bar-label { font-weight: 700; }

.bar-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--bar-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- Hint ---- */
.hint-text {
  margin-top: 0.75rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}
</style>
