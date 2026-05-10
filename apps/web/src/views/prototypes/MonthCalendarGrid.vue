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

// Build the calendar grid: weeks as rows, 7 days each (Mon → Sun)
const calendarWeeks = computed(() => {
  const year = currentMonthDate.value.getFullYear();
  const month = currentMonthDate.value.getMonth();
  const firstDay = new Date(year, month, 1);
  // Monday = 0 offset
  const startOffset = (firstDay.getDay() + 6) % 7; // Mon=0, Sun=6
  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = [];

  // Fill leading nulls
  for (let i = 0; i < startOffset; i++) week.push(null);

  for (let d = 1; d <= daysInMonth.value; d++) {
    week.push(new Date(year, month, d));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  // Fill trailing nulls
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return weeks;
});

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

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

// ---- Color palette per machine ----
const PALETTE = [
  { bg: "rgba(102,126,234,0.28)", border: "#667eea", text: "#a5b4fc" },
  { bg: "rgba(52,211,153,0.22)", border: "#34d399", text: "#6ee7b7" },
  { bg: "rgba(251,191,36,0.22)", border: "#fbbf24", text: "#fcd34d" },
  { bg: "rgba(96,165,250,0.22)", border: "#60a5fa", text: "#93c5fd" },
  { bg: "rgba(248,113,113,0.22)", border: "#f87171", text: "#fca5a5" },
  { bg: "rgba(192,132,252,0.22)", border: "#c084fc", text: "#e9d5ff" },
  { bg: "rgba(45,212,191,0.22)", border: "#2dd4bf", text: "#99f6e4" },
  { bg: "rgba(251,146,60,0.22)", border: "#fb923c", text: "#fed7aa" },
];

function machineColor(machineId: number) {
  const idx = machinesStore.machines.findIndex((m) => m.id === machineId);
  return PALETTE[(idx >= 0 ? idx : 0) % PALETTE.length];
}

// ---- Events per day ----
interface DayEvent {
  machineId: number;
  machineName: string;
  allocation: Allocation;
  color: (typeof PALETTE)[0];
  isPending: boolean;
  isFinished: boolean;
  label: string;
}

function eventsForDay(day: Date | null): DayEvent[] {
  if (!day) return [];
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  return allocations.value
    .filter(
      (a) =>
        ["approved", "pending", "finished"].includes(a.status) &&
        new Date(a.startTime) <= dayEnd &&
        new Date(a.endTime) >= dayStart,
    )
    .map((a) => {
      const machine = machinesStore.machines.find((m) => m.id === a.machineId);
      return {
        machineId: a.machineId,
        machineName: machine?.name ?? `#${a.machineId}`,
        allocation: a,
        color: machineColor(a.machineId),
        isPending: a.status === "pending",
        isFinished: a.status === "finished",
        label: machine?.name ?? `Máquina #${a.machineId}`,
      };
    })
    .sort((a, b) => a.machineId - b.machineId);
}

// ---- Day detail panel ----
const selectedDay = ref<Date | null>(null);
const selectedDayEvents = computed(() =>
  selectedDay.value ? eventsForDay(selectedDay.value) : [],
);

function selectDay(day: Date | null) {
  if (!day) return;
  if (
    selectedDay.value &&
    selectedDay.value.toDateString() === day.toDateString()
  ) {
    selectedDay.value = null;
  } else {
    selectedDay.value = day;
  }
}

function fmtDayTitle(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
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
    const days = Math.ceil(
      (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24),
    );
    return `${fmtDate(s)} → ${fmtDate(e)} · ${days} dias`;
  }
  return `${fmtTime(s)} – ${fmtTime(e)}`;
}

function statusChip(s: string) {
  const map: Record<string, { cls: string; label: string }> = {
    approved: { cls: "badge-success", label: "Aprovada" },
    pending: { cls: "badge-warning", label: "Pendente" },
    finished: { cls: "badge-info", label: "Finalizada" },
  };
  return map[s] ?? { cls: "badge-muted", label: s };
}

// Count approved+pending allocations in a day (for density display)
function dayDensity(day: Date | null): number {
  return eventsForDay(day).filter((e) => !e.isFinished).length;
}

onMounted(loadData);
</script>

<template>
  <div class="fade-in proto-wrap">
    <div class="proto-banner">
      <span class="proto-tag">PROTÓTIPO B</span>
      Grade Mensal — Visualização tradicional de calendário
    </div>

    <div class="page-header">
      <h1 class="page-title">Calendário de Alocações — Grade Mensal</h1>
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
      </div>

      <div class="grid-layout" :class="{ 'with-panel': selectedDay }">
        <!-- Calendar grid -->
        <div class="cal-grid-container">
          <!-- Weekday headers -->
          <div class="cal-weekdays">
            <div
              v-for="name in WEEKDAY_LABELS"
              :key="name"
              class="weekday-header"
              :class="{ weekend: name === 'Sáb' || name === 'Dom' }"
            >
              {{ name }}
            </div>
          </div>

          <!-- Weeks -->
          <div class="cal-weeks">
            <div
              v-for="(week, wi) in calendarWeeks"
              :key="wi"
              class="cal-week-row"
            >
              <div
                v-for="(day, di) in week"
                :key="di"
                class="cal-day-cell"
                :class="{
                  empty: !day,
                  today: day && isToday(day),
                  weekend: day && isWeekend(day),
                  selected:
                    day &&
                    selectedDay &&
                    day.toDateString() === selectedDay.toDateString(),
                  'has-events': day && eventsForDay(day).length > 0,
                }"
                @click="selectDay(day)"
              >
                <template v-if="day">
                  <div class="day-number-row">
                    <span class="day-number">{{ day.getDate() }}</span>
                    <div
                      v-if="dayDensity(day) > 0"
                      class="density-dots"
                    >
                      <span
                        v-for="n in Math.min(dayDensity(day), 4)"
                        :key="n"
                        class="density-dot"
                      ></span>
                      <span v-if="dayDensity(day) > 4" class="density-more">
                        +{{ dayDensity(day) - 4 }}
                      </span>
                    </div>
                  </div>

                  <!-- Machine chips -->
                  <div class="day-chips">
                    <div
                      v-for="(ev, ei) in eventsForDay(day).slice(0, 3)"
                      :key="ei"
                      class="machine-chip"
                      :class="{ pending: ev.isPending, finished: ev.isFinished }"
                      :style="{
                        '--chip-bg': ev.color.bg,
                        '--chip-border': ev.color.border,
                        '--chip-text': ev.color.text,
                      }"
                      :title="ev.machineName + (ev.allocation.user ? ' · ' + ev.allocation.user.fullName : '')"
                    >
                      {{ ev.machineName.replace("PC-LAB-", "") }}
                    </div>
                    <div
                      v-if="eventsForDay(day).length > 3"
                      class="chip-overflow"
                    >
                      +{{ eventsForDay(day).length - 3 }}
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Day detail panel -->
        <aside v-if="selectedDay" class="detail-panel fade-in">
          <div class="panel-card">
            <div class="panel-header">
              <h2 class="panel-title" style="font-size:1rem; text-transform:capitalize">
                {{ fmtDayTitle(selectedDay) }}
              </h2>
              <button class="btn-close" @click="selectedDay = null">✕</button>
            </div>

            <div class="panel-body">
              <div
                v-if="selectedDayEvents.length === 0"
                class="empty-state"
                style="padding: 2rem 0"
              >
                Nenhuma alocação neste dia.
              </div>

              <div
                v-for="(ev, i) in selectedDayEvents"
                :key="i"
                class="event-card"
                :style="{
                  '--ev-border': ev.color.border,
                  '--ev-bg': ev.color.bg,
                }"
              >
                <div class="event-machine">
                  <span
                    class="event-machine-dot"
                    :style="{ background: ev.color.border }"
                  ></span>
                  <span class="event-machine-name">{{ ev.machineName }}</span>
                  <span :class="['badge', statusChip(ev.allocation.status).cls]">
                    {{ statusChip(ev.allocation.status).label }}
                  </span>
                </div>
                <div class="event-user" v-if="ev.allocation.user">
                  {{ ev.allocation.user.fullName }}
                </div>
                <div class="event-range">
                  {{ fmtDateRange(ev.allocation.startTime, ev.allocation.endTime) }}
                </div>
                <div class="event-reason" v-if="ev.allocation.reason">
                  {{ ev.allocation.reason }}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <!-- Legend -->
      <div class="bottom-legend">
        <span class="leg-item">
          <span class="leg-swatch" style="background:rgba(102,126,234,0.4);border-color:#667eea"></span>
          Aprovada
        </span>
        <span class="leg-item">
          <span class="leg-swatch" style="background:rgba(251,191,36,0.35);border-color:#fbbf24;border-style:dashed"></span>
          Pendente
        </span>
        <span class="leg-item">
          <span class="leg-swatch" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.2)"></span>
          Finalizada
        </span>
        <span class="leg-item">
          <span
            class="leg-today"
          ></span>
          Hoje
        </span>
      </div>

      <p class="hint-text">
        💡 Clique em um dia para ver os detalhes das alocações.
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

/* ---- Grid layout ---- */
.grid-layout {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}
.grid-layout.with-panel .cal-grid-container {
  flex: 1;
  min-width: 0;
}
.cal-grid-container { width: 100%; }

/* ---- Weekday headers ---- */
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 2px;
}
.weekday-header {
  text-align: center;
  padding: 0.5rem 0;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.weekday-header.weekend { color: rgba(255, 255, 255, 0.25); }

/* ---- Weeks ---- */
.cal-weeks {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}

.cal-week-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid var(--border-subtle);
}
.cal-week-row:last-child { border-bottom: none; }

/* ---- Day cells ---- */
.cal-day-cell {
  min-height: 110px;
  padding: 0.5rem;
  border-right: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background var(--transition);
  position: relative;
}
.cal-day-cell:last-child { border-right: none; }
.cal-day-cell.empty { cursor: default; background: rgba(255,255,255,0.01); }
.cal-day-cell:not(.empty):hover { background: var(--bg-hover); }
.cal-day-cell.weekend:not(.empty) { background: rgba(255,255,255,0.012); }
.cal-day-cell.today { background: rgba(124, 108, 240, 0.07); }
.cal-day-cell.today:hover { background: rgba(124, 108, 240, 0.12); }
.cal-day-cell.selected {
  background: rgba(124, 108, 240, 0.12);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}

/* ---- Day number row ---- */
.day-number-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.day-number {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1;
}
.cal-day-cell.today .day-number {
  color: #fff;
  background: var(--gradient-accent);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.82rem;
  font-weight: 700;
}

/* ---- Density dots ---- */
.density-dots {
  display: flex;
  align-items: center;
  gap: 2px;
}
.density-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.6;
}
.density-more {
  font-size: 0.62rem;
  color: var(--text-muted);
}

/* ---- Machine chips ---- */
.day-chips {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.machine-chip {
  display: block;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  background: var(--chip-bg);
  border-left: 2px solid var(--chip-border);
  color: var(--chip-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: filter var(--transition);
}
.machine-chip:hover { filter: brightness(1.3); }
.machine-chip.pending { border-style: dashed; opacity: 0.85; }
.machine-chip.finished { opacity: 0.5; filter: grayscale(0.5); }

.chip-overflow {
  font-size: 0.65rem;
  color: var(--text-muted);
  padding-left: 4px;
}

/* ---- Detail panel ---- */
.detail-panel { width: 320px; flex-shrink: 0; }

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

.panel-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
}

.panel-body { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }

/* ---- Event card ---- */
.event-card {
  background: var(--ev-bg);
  border: 1px solid rgba(255,255,255,0.06);
  border-left: 3px solid var(--ev-border);
  border-radius: var(--radius);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.event-machine {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.event-machine-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.event-machine-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}
.event-user {
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.event-range {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-feature-settings: "tnum";
}
.event-reason {
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-style: italic;
}

/* ---- Bottom legend ---- */
.bottom-legend {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}
.leg-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.leg-swatch {
  display: inline-block;
  width: 24px;
  height: 10px;
  border-radius: 2px;
  border: 1.5px solid transparent;
}
.leg-today {
  display: inline-block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--gradient-accent);
}

.hint-text {
  margin-top: 0.5rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .grid-layout { flex-direction: column; }
  .detail-panel { width: 100%; }
  .cal-day-cell { min-height: 80px; }
}
</style>
