<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { Allocation, Machine } from "@/types";

const props = withDefaults(
  defineProps<{
    machines?: Machine[];
    allocations?: Allocation[];
    currentUserId?: number | null;
    loading?: boolean;
    /** Modo compacto: uma máquina, toolbar reduzida, linhas mais baixas */
    compact?: boolean;
  }>(),
  {
    machines: () => [],
    allocations: () => [],
    currentUserId: null,
    loading: false,
    compact: false,
  },
);

// NOVO: Declarar o evento que envia o alinhamento para o elemento pai
const emit = defineEmits<{
  (e: "offset-calculated", offset: number): void;
}>();

const ganttOuterRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

// NOVO: Função que calcula o topo exato do calendario
function updateAlignOffset() {
  if (ganttOuterRef.value) {
    const offset = ganttOuterRef.value.offsetTop;
    emit("offset-calculated", offset);
  }
}

watch(() => props.loading, async (isLoading) => {
  if (!isLoading) {
    await nextTick(); // Espera o Vue desenhar o HTML
    
    if (ganttOuterRef.value) {
      if (resizeObserver) resizeObserver.disconnect();
      
      // Cria o observador que "gruda" na caixa principal do calendário
      resizeObserver = new ResizeObserver(() => {
        updateAlignOffset();
      });
      resizeObserver.observe(ganttOuterRef.value);
      
      // Força a primeira atualização imediatamente
      updateAlignOffset();
    }
  }
}, { immediate: true });

const machinesStore = useMachinesStore();

// ---- Machine viewport: 8 visible at a time, snap scroll ----
const PAGE_SIZE = 8;
const machineOffset = ref(0);

const maxOffset = computed(() =>
  Math.max(0, (props.machines?.length ?? 0) - PAGE_SIZE),
);

const displayedMachines = computed(() =>
  (props.machines ?? []).slice(
    machineOffset.value,
    machineOffset.value + PAGE_SIZE,
  ),
);

function scrollMachines(delta: number) {
  machineOffset.value = Math.max(
    0,
    Math.min(maxOffset.value, machineOffset.value + delta),
  );
}

// ---- Row height helpers (extend first/last rows to host scroll buttons) ----
function rowH(idx: number): number {
  if (maxOffset.value === 0) return ROW_H.value;
  const last = displayedMachines.value.length - 1;
  return idx === 0 || idx === last ? ROW_H.value + BTN_H : ROW_H.value;
}
function barTopOffset(idx: number): number {
  const center = Math.round((ROW_H.value - BAR_H.value) / 2);
  if (maxOffset.value === 0) return center;
  if (idx === 0) return BTN_H + center;
  return center;
}
function labelRowStyle(idx: number) {
  const needsScroll = maxOffset.value > 0;
  const last = displayedMachines.value.length - 1;
  return {
    height: rowH(idx) + "px",
    paddingTop: (needsScroll && idx === 0 ? BTN_H : 0) + "px",
    paddingBottom: (needsScroll && idx === last ? BTN_H : 0) + "px",
  };
}
const ganttLeftEl = ref<HTMLElement | null>(null);
function onLeftWheel(e: WheelEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.deltaY > 0) scrollMachines(1);
  else if (e.deltaY < 0) scrollMachines(-1);
}

// ---- Timeline constants ----
const PAST_DAYS = 30;
const FUTURE_DAYS = 60;
const CELL_W = computed(() => (props.compact ? 40 : 46));
const MONTH_HEADER_H = computed(() => (props.compact ? 24 : 30));
const DAY_HEADER_H = computed(() => (props.compact ? 36 : 46));
const ROW_H = computed(() => (props.compact ? 48 : 66));
const BAR_H = computed(() => (props.compact ? 26 : 38));
const BTN_H = 20;
const TOTAL_HEADER_H = computed(
  () => MONTH_HEADER_H.value + DAY_HEADER_H.value,
);
const TOTAL_DAYS = PAST_DAYS + 1 + FUTURE_DAYS;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const isSingleMachine = computed(() => (props.machines?.length ?? 0) <= 1);

const todayRef = new Date();
todayRef.setHours(0, 0, 0, 0);

// ---- Timeline days array ----
const timelineDays = computed(() => {
  const days: Date[] = [];
  for (let i = -PAST_DAYS; i <= FUTURE_DAYS; i++) {
    const d = new Date(todayRef);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
});

const totalWidth = computed(() => TOTAL_DAYS * CELL_W.value);

const todayLineX = computed(() => PAST_DAYS * CELL_W.value + CELL_W.value / 2);
const todayColLeft = computed(() => PAST_DAYS * CELL_W.value);

// ---- Month spans (for header labels + bg gradient) ----
const monthSpans = computed(() => {
  const spans: {
    label: string;
    shortLabel: string;
    leftPx: number;
    widthPx: number;
    idx: number;
  }[] = [];
  const days = timelineDays.value;
  let i = 0;
  while (i < days.length) {
    const currentDay = days[i]!; // <-- Garantia aqui
    const m = currentDay.getMonth();
    const y = currentDay.getFullYear();
    let j = i;
    while (
      j < days.length &&
      days[j]!.getMonth() === m && // <-- Garantia aqui
      days[j]!.getFullYear() === y   // <-- Garantia aqui
    )
      j++;
    const count = j - i;
    spans.push({
      label: currentDay
        .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
        .replace(/^\w/, (c) => c.toUpperCase()),
      shortLabel: currentDay
        .toLocaleDateString("pt-BR", { month: "short" })
        .replace(".", "")
        .toUpperCase(),
      leftPx: i * CELL_W.value,
      widthPx: count * CELL_W.value,
      idx: spans.length,
    });
    i = j;
  }
  return spans;
});

// Alternating month bg gradient
const monthBgStyle = computed(() => {
  const stops: string[] = [];
  monthSpans.value.forEach((span) => {
    const color =
      span.idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.018)";
    stops.push(`${color} ${span.leftPx}px`);
    stops.push(`${color} ${span.leftPx + span.widthPx}px`);
  });
  if (stops.length === 0) return {};
  return {
    backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`,
  };
});

// ---- Helpers ----
function isToday(d: Date) {
  return d.toDateString() === todayRef.toDateString();
}
function isWeekend(d: Date) {
  return d.getDay() === 0 || d.getDay() === 6;
}
function isMonthStart(d: Date) {
  return d.getDate() === 1;
}
const DAY_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];

// ---- Color palette ----
const PALETTE = [
  { bg: "rgba(102,126,234,0.32)", border: "#667eea", text: "#a5b4fc" },
  { bg: "rgba(52,211,153,0.27)", border: "#34d399", text: "#6ee7b7" },
  { bg: "rgba(251,191,36,0.27)", border: "#fbbf24", text: "#fcd34d" },
  { bg: "rgba(96,165,250,0.27)", border: "#60a5fa", text: "#93c5fd" },
  { bg: "rgba(248,113,113,0.27)", border: "#f87171", text: "#fca5a5" },
  { bg: "rgba(192,132,252,0.27)", border: "#c084fc", text: "#e9d5ff" },
  { bg: "rgba(45,212,191,0.27)", border: "#2dd4bf", text: "#99f6e4" },
  { bg: "rgba(251,146,60,0.27)", border: "#fb923c", text: "#fed7aa" },
];

function machineColor(machineId: number) {
  const idx = (props.machines ?? []).findIndex((m) => m.id === machineId);
  return PALETTE[(idx >= 0 ? idx : 0) % PALETTE.length]!;
}

// ---- Gantt bars ----
function barsForMachine(machineId: number) {
  const timelineStart = timelineDays.value[0];
  const lastDay = timelineDays.value[timelineDays.value.length - 1];

  if (!timelineStart || !lastDay) return [];

  const timelineEnd = new Date(lastDay);
  timelineEnd.setHours(23, 59, 59, 999);
  const timelineStartMs = timelineStart.getTime();

  return (props.allocations ?? [])
    .filter(
      (a) =>
        a.machineId === machineId &&
        ["approved", "pending", "finished"].includes(a.status) &&
        new Date(a.startTime) <= timelineEnd &&
        new Date(a.endTime) >= timelineStart,
    )
    .map((a) => {
      const s = new Date(a.startTime);
      const e = new Date(a.endTime);
      const cs = s < timelineStart ? timelineStart : s;
      const ce = e > timelineEnd ? timelineEnd : e;

      const leftDays = (cs.getTime() - timelineStartMs) / MS_PER_DAY;
      const widthDays = Math.max(
        0.85,
        (ce.getTime() - cs.getTime()) / MS_PER_DAY,
      );

      const color = machineColor(machineId);
      return {
        allocation: a,
        leftPx: leftDays * CELL_W.value,
        widthPx: widthDays * CELL_W.value,
        color,
        isPending: a.status === "pending",
        isFinished: a.status === "finished",
        isOwn:
          a.isOwn === true ||
          (props.currentUserId !== null && a.userId === props.currentUserId),
        tooltip: buildTooltip(a),
      };
    })
    .sort((a, b) => a.leftPx - b.leftPx);
}

function buildTooltip(a: Allocation) {
  const s = new Date(a.startTime);
  const e = new Date(a.endTime);
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  const fmtT = (d: Date) =>
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const multi = s.toDateString() !== e.toDateString();
  const days = Math.ceil((e.getTime() - s.getTime()) / MS_PER_DAY);
  const range = multi
    ? `${fmt(s)} → ${fmt(e)} (${days}d)`
    : `${fmt(s)} ${fmtT(s)} – ${fmtT(e)}`;
  const user = a.user?.fullName ?? "Usuário";
  const st: Record<string, string> = {
    approved: "Aprovada",
    pending: "Pendente",
    finished: "Finalizada",
  };
  const own =
    a.isOwn === true ||
    (props.currentUserId !== null && a.userId === props.currentUserId);
  const ownMark = own ? " (você)" : "";
  return `${user}${ownMark}\n${range}\n${a.reason ?? ""}\n[${st[a.status] ?? a.status}]`;
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
    {
      available: "Disponível",
      occupied: "Ocupada",
      maintenance: "Manutenção",
      offline: "Offline",
    }[s] ?? s
  );
}

// ---- Visible month label ----
const scrollLeft = ref(0);

const visibleMonthLabel = computed(() => {
  const centerPx = scrollLeft.value + (scrollEl.value?.clientWidth ?? 800) / 2;
  
  for (let i = monthSpans.value.length - 1; i >= 0; i--) {
    const span = monthSpans.value[i]!; // <-- Garantia para o TS aqui
    
    if (centerPx >= span.leftPx) {
      return span.label;
    }
  }
  
  return monthSpans.value[0]?.label ?? "";
});

// ---- Scroll logic ----
const scrollEl = ref<HTMLElement | null>(null);

let isDragging = false;
let dragStartX = 0;
let dragScrollLeft = 0;

function onMouseDown(e: MouseEvent) {
  if (!scrollEl.value) return;
  isDragging = true;
  dragStartX = e.pageX;
  dragScrollLeft = scrollEl.value.scrollLeft;
  scrollEl.value.style.cursor = "grabbing";
  scrollEl.value.style.userSelect = "none";
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging || !scrollEl.value) return;
  const walk = (dragStartX - e.pageX) * 1.4;
  scrollEl.value.scrollLeft = dragScrollLeft + walk;
}

function stopDrag() {
  if (!isDragging) return;
  isDragging = false;
  if (scrollEl.value) {
    scrollEl.value.style.cursor = "grab";
    scrollEl.value.style.userSelect = "";
  }
}

function onWheel(e: WheelEvent) {
  if (!scrollEl.value) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    scrollEl.value.scrollLeft += e.deltaY * 1.4;
  }
}

function onScroll() {
  scrollLeft.value = scrollEl.value?.scrollLeft ?? 0;
}

function jumpBy(px: number) {
  scrollEl.value?.scrollBy({ left: px, behavior: "smooth" });
}

function scrollToToday() {
  if (!scrollEl.value) return;
  const w = scrollEl.value.clientWidth;
  scrollEl.value.scrollTo({ left: todayLineX.value - w / 2, behavior: "smooth" });
}

onMounted(async () => {
  await nextTick();
  updateAlignOffset();
  window.addEventListener("resize", updateAlignOffset);
  if (scrollEl.value) {
    const w = scrollEl.value.clientWidth;
    scrollEl.value.scrollLeft = todayLineX.value - w / 2;
    scrollLeft.value = scrollEl.value.scrollLeft;
    scrollEl.value.style.cursor = "grab";
    scrollEl.value.addEventListener("wheel", onWheel, { passive: false });
    scrollEl.value.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", stopDrag);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateAlignOffset);
  scrollEl.value?.removeEventListener("wheel", onWheel);
  scrollEl.value?.removeEventListener("scroll", onScroll);
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", stopDrag);
});
</script>

<template>
  <div class="gantt-wrap" :class="{ 'gantt-wrap--compact': compact }">
    <div v-if="loading" class="empty-state">Carregando calendário...</div>

    <template v-else>
      <!-- Toolbar: context indicator + controls -->
      <div class="toolbar">
        <div class="month-indicator">
          <span class="month-indicator-dot"></span>
          <span class="month-indicator-label">{{ visibleMonthLabel }}</span>
        </div>

        <div class="toolbar-controls">
          <div v-if="!compact" class="legend">
            <span class="leg-item">
              <span class="leg-bar own-leg"></span>Sua alocação
            </span>
            <span class="leg-item">
              <span class="leg-bar approved"></span>Aprovada
            </span>
            <span class="leg-item">
              <span class="leg-bar pending"></span>Pendente
            </span>
            <span class="leg-item">
              <span class="leg-bar finished"></span>Finalizada
            </span>
            <span class="leg-sep"></span>
            <span class="leg-item drag-hint">
              <span class="drag-icon">⇄</span> Arraste ou role com o mouse
            </span>
          </div>
          <button class="btn btn-ghost btn-sm today-btn" @click="scrollToToday">
            ◎ Hoje
          </button>
        </div>
      </div>

      <!-- Gantt layout: fixed left + scrollable right -->
      <div class="gantt-outer" ref="ganttOuterRef">
        <!-- ---- Left: machine labels (fixed) ---- -->
        <div class="gantt-left" ref="ganttLeftEl" @wheel="onLeftWheel">
          <!-- Spacer matching both header rows -->
          <div class="left-header" :style="{ height: TOTAL_HEADER_H + 'px' }">
            <span class="left-header-label">
              Máquina
              <span v-if="!isSingleMachine" class="machines-range"
                >{{ machineOffset + 1 }}–{{
                  Math.min(machineOffset + PAGE_SIZE, machines.length)
                }}
                / {{ machines.length }}</span
              >
            </span>
          </div>

          <!-- Scroll UP button (absolute, overlays first row) -->
          <button
            class="machine-scroll-btn machine-scroll-btn--up"
            :style="{ top: TOTAL_HEADER_H + 'px' }"
            :disabled="machineOffset === 0"
            @click="scrollMachines(-1)"
          >
            ▲
          </button>

          <!-- Machine label rows -->
          <div
            v-for="(machine, idx) in displayedMachines"
            :key="machine.id"
            class="machine-label-row"
            :style="labelRowStyle(idx)"
          >
            <span class="machine-name">{{ machine.name }}</span>
            <span
              :class="['badge', statusBadge(machine.status)]"
              style="font-size: 0.62rem"
            >
              {{ statusLabel(machine.status) }}
            </span>
          </div>

          <!-- Scroll DOWN button (absolute, overlays last row) -->
          <button
            class="machine-scroll-btn machine-scroll-btn--down"
            :disabled="machineOffset >= maxOffset"
            @click="scrollMachines(1)"
          >
            ▼
          </button>
        </div>

        <!-- ---- Right: scroll wrapper ---- -->
        <div class="scroll-wrapper">
          <!-- Arrow buttons floating over the scroll area -->
          <button class="scroll-arrow left" @click="jumpBy(-CELL_W * 5)">
            ‹
          </button>
          <button class="scroll-arrow right" @click="jumpBy(CELL_W * 5)">
            ›
          </button>

          <!-- Scrollable container (no visible scrollbar) -->
          <div
            class="gantt-scroll"
            ref="scrollEl"
            @mousedown.prevent="onMouseDown"
          >
            <div
              class="timeline-inner"
              :style="{ width: totalWidth + 'px', ...monthBgStyle }"
            >
              <!-- Month header row -->
              <div
                class="month-row"
                :style="{ height: MONTH_HEADER_H + 'px', position: 'relative' }"
              >
                <div
                  v-for="span in monthSpans"
                  :key="span.leftPx"
                  class="month-span"
                  :style="{
                    left: span.leftPx + 'px',
                    width: span.widthPx + 'px',
                    height: MONTH_HEADER_H + 'px',
                  }"
                >
                  <span class="month-span-label">{{ span.label }}</span>
                </div>
              </div>

              <!-- Day header row -->
              <div class="day-row" :style="{ height: DAY_HEADER_H + 'px' }">
                <div
                  v-for="(day, di) in timelineDays"
                  :key="di"
                  class="day-cell"
                  :class="{
                    today: isToday(day),
                    weekend: isWeekend(day),
                    'month-start': isMonthStart(day),
                  }"
                  :style="{ width: CELL_W + 'px', height: DAY_HEADER_H + 'px' }"
                >
                  <span class="d-num">{{ day.getDate() }}</span>
                  <span class="d-letter">{{ DAY_LETTERS[day.getDay()] }}</span>
                </div>
              </div>

              <!-- Machine track rows -->
              <div
                v-for="(machine, idx) in displayedMachines"
                :key="machine.id"
                class="track-row"
                :style="{
                  height: rowH(idx) + 'px',
                  '--bar-top': barTopOffset(idx) + 'px',
                }"
              >
                <!-- Today column background highlight -->
                <div
                  class="today-col-bg"
                  :style="{
                    left: todayColLeft + 'px',
                    width: CELL_W + 'px',
                  }"
                ></div>

                <!-- Today vertical line -->
                <div
                  class="today-line"
                  :style="{ left: todayLineX + 'px' }"
                ></div>

                <!-- Allocation bars -->
                <div
                  v-for="(bar, bi) in barsForMachine(machine.id)"
                  :key="bi"
                  class="gantt-bar"
                  :class="{
                    pending: bar.isPending,
                    finished: bar.isFinished,
                    own: bar.isOwn,
                  }"
                  :style="{
                    left: bar.leftPx + 'px',
                    width: bar.widthPx + 'px',
                    '--bar-bg': bar.color.bg,
                    '--bar-border': bar.color.border,
                    '--bar-text': bar.color.text,
                  }"
                  :title="bar.tooltip"
                >
                  <span class="bar-label">
                    {{ bar.allocation.user?.fullName ?? "Reserva"
                    }}{{ bar.isOwn ? " ✦" : "" }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom hint -->
      <p class="hint-text">
        💡 Passe o mouse sobre as barras para detalhes · Arraste ou role com o
        mouse para navegar · Janela: {{ PAST_DAYS }} dias passados +
        {{ FUTURE_DAYS }} dias futuros
      </p>
    </template>
  </div>
</template>

<style scoped>
.gantt-wrap {
  max-width: 100%;
  position: relative;
}

/* ---- Toolbar ---- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.85rem;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.toolbar-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.today-btn {
  font-weight: 600;
}

/* Month indicator pill */
.month-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 0.3rem 0.85rem;
}
.month-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 2s infinite;
}
.month-indicator-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

/* Legend */
.legend {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
}
.leg-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.leg-bar {
  display: inline-block;
  width: 22px;
  height: 8px;
  border-radius: 2px;
  border-left: 3px solid;
}
.leg-bar.approved {
  background: rgba(102, 126, 234, 0.35);
  border-color: #667eea;
}
.leg-bar.pending {
  background: rgba(251, 191, 36, 0.3);
  border-color: #fbbf24;
  border-left-style: dashed;
}
.leg-bar.finished {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.22);
}
.leg-bar.own-leg {
  background: rgba(255, 255, 255, 0.15);
  border-color: #fff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.4);
}
.leg-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
}
.drag-hint {
  color: var(--text-muted);
}
.drag-icon {
  font-size: 1rem;
}

/* ---- Main gantt layout ---- */
.gantt-outer {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

/* ---- Left: machine label panel ---- */
.gantt-left {
  flex-shrink: 0;
  width: 190px;
  border-right: 1px solid var(--border);
  background: var(--bg-card-solid);
  z-index: 2;
  display: flex;
  flex-direction: column;
  position: relative;
}

.left-header {
  display: flex;
  align-items: flex-end;
  padding: 0 1rem 0.5rem;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.015);
}

.left-header-label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.machines-range {
  font-size: 0.65rem;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-muted);
  opacity: 0.75;
}

/* ---- Machine scroll strip buttons ---- */
.machine-scroll-btn {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  background: rgba(12, 12, 22, 0.72);
  border: none;
  color: var(--text-muted);
  font-size: 0.6rem;
  cursor: pointer;
  user-select: none;
  transition:
    background 0.15s,
    color 0.15s;
  z-index: 3;
  border-radius: 0;
}
.machine-scroll-btn--up {
  border-bottom: 1px solid var(--border);
}
.machine-scroll-btn--down {
  bottom: 0;
  border-top: 1px solid var(--border);
  border-bottom-left-radius: var(--radius-lg);
}
.machine-scroll-btn:hover:not(:disabled) {
  background: rgba(124, 108, 240, 0.22);
  color: var(--text-primary);
}
.machine-scroll-btn:disabled {
  opacity: 0.2;
  cursor: default;
}

.machine-label-row {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.22rem;
  padding: 0 1rem;
  border-bottom: 1px solid var(--border-subtle);
}
.machine-label-row:last-child {
  border-bottom: none;
}

.machine-name {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- Right: scroll wrapper ---- */
.scroll-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-width: 0;
}

/* Arrow buttons */
.scroll-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  width: 28px;
  height: 56px;
  background: rgba(13, 13, 24, 0.82);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 1.3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background var(--transition),
    color var(--transition);
  backdrop-filter: blur(4px);
  padding: 0;
  line-height: 1;
}
.scroll-arrow:hover {
  background: rgba(124, 108, 240, 0.25);
  color: var(--text-primary);
  border-color: rgba(124, 108, 240, 0.4);
}
.scroll-arrow.left {
  left: 4px;
}
.scroll-arrow.right {
  right: 4px;
}

/* Scrollable container — hidden scrollbar */
.gantt-scroll {
  overflow-x: scroll;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  cursor: grab;
}
.gantt-scroll::-webkit-scrollbar {
  display: none;
}
.gantt-scroll:active {
  cursor: grabbing;
}

/* ---- Timeline inner ---- */
.timeline-inner {
  position: relative;
}

.timeline-inner::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    to right,
    transparent 0px,
    transparent 45px,
    var(--border-subtle) 45px,
    var(--border-subtle) 46px
  );
  pointer-events: none;
  z-index: 0;
}

/* ---- Month header row ---- */
.month-row {
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.01);
}

.month-span {
  position: absolute;
  display: flex;
  align-items: center;
  padding-left: 8px;
  overflow: hidden;
  border-right: 1px solid var(--border);
}
.month-span:last-child {
  border-right: none;
}

.month-span-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- Day header row ---- */
.day-row {
  display: flex;
  border-bottom: 2px solid var(--border);
  background: rgba(255, 255, 255, 0.01);
  position: relative;
  z-index: 1;
}

.day-cell {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  position: relative;
  transition: background var(--transition);
}

.day-cell.weekend {
  background: rgba(255, 255, 255, 0.012);
}
.day-cell.today {
  background: rgba(124, 108, 240, 0.1);
}
.day-cell.month-start::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(124, 108, 240, 0.35);
}

.d-num {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1;
}
.d-letter {
  font-size: 0.58rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
}
.day-cell.today .d-num {
  color: #fff;
  background: var(--gradient-accent);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.74rem;
  font-weight: 700;
}
.day-cell.today .d-letter {
  color: var(--accent);
}

/* ---- Track rows ---- */
.track-row {
  position: relative;
  border-bottom: 1px solid var(--border-subtle);
  z-index: 1;
}
.track-row:last-child {
  border-bottom: none;
}

/* Today column background */
.today-col-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(124, 108, 240, 0.06);
  pointer-events: none;
  z-index: 0;
}

/* Today vertical line */
.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
  opacity: 0.55;
  z-index: 3;
  pointer-events: none;
  transform: translateX(-50%);
}

/* ---- Allocation bars ---- */
.gantt-bar {
  position: absolute;
  top: var(--bar-top, 14px);
  height: 38px;
  background: var(--bar-bg);
  border-left: 3px solid var(--bar-border);
  border-radius: 0 5px 5px 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
  cursor: default;
  z-index: 2;
  transition:
    filter var(--transition),
    transform var(--transition);
  overflow: hidden;
  min-width: 6px;
}
.gantt-bar:hover {
  filter: brightness(1.35);
  transform: scaleY(1.07);
  z-index: 4;
}
.gantt-bar.pending {
  --bar-bg: rgba(251, 191, 36, 0.18);
  --bar-border: #fbbf24;
  --bar-text: #fcd34d;
  border-left-style: dashed;
}
.gantt-bar.finished {
  --bar-bg: rgba(255, 255, 255, 0.05);
  --bar-border: rgba(255, 255, 255, 0.18);
  --bar-text: var(--text-muted);
  opacity: 0.7;
}
.gantt-bar.own {
  box-shadow:
    0 0 0 1.5px rgba(255, 255, 255, 0.6),
    0 0 12px rgba(124, 108, 240, 0.5);
  z-index: 3;
}
.gantt-bar.own .bar-label {
  font-weight: 700;
}
.bar-label {
  font-size: 0.67rem;
  font-weight: 600;
  color: var(--bar-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.gantt-wrap--compact .toolbar {
  padding: 0.35rem 0.5rem;
}

.gantt-wrap--compact .machine-name {
  font-size: 0.82rem;
}

/* ---- Hint ---- */
.hint-text {
  margin-top: 0.75rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}
</style>
