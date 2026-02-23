<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import { useAuthStore } from "@/stores/auth";
import type { Allocation, Machine } from "@/types";
import NewAllocationModal from "@/components/NewAllocationModal.vue";

const allocStore = useAllocationsStore();
const machinesStore = useMachinesStore();
const auth = useAuthStore();

// ---- Estado do calendário ----
const today = new Date();
const currentYear = ref(today.getFullYear());
const currentMonth = ref(today.getMonth()); // 0-indexed
const selectedDate = ref<string>(formatDate(today));
const showNewModal = ref(false);

// Filtro de máquina
const filterMachineId = ref<number | null>(null);

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const weekDays = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

// ---- Helpers ----
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// ---- Calendário grid ----
const calendarDays = computed(() => {
  const first = new Date(currentYear.value, currentMonth.value, 1);
  const lastDay = new Date(
    currentYear.value,
    currentMonth.value + 1,
    0,
  ).getDate();
  const startWeekday = first.getDay();

  const days: Array<{ day: number; date: string } | null> = [];

  // Espaços em branco antes do dia 1
  for (let i = 0; i < startWeekday; i++) days.push(null);

  for (let d = 1; d <= lastDay; d++) {
    const date = `${currentYear.value}-${String(currentMonth.value + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({ day: d, date });
  }

  return days;
});

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else {
    currentMonth.value--;
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value++;
  }
}

// ---- Reservas do dia selecionado ----
const dayAllocations = computed(() => {
  if (!selectedDate.value) return [];
  return allocStore.allocations
    .filter((a) => {
      const allocDate = a.startTime.split("T")[0];
      if (allocDate !== selectedDate.value) return false;
      if (filterMachineId.value && a.machineId !== filterMachineId.value)
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
});

// Indicadores no calendário (quais dias têm reservas do próprio user)
function dayHasMyAlloc(dateStr: string): boolean {
  return allocStore.allocations.some((a) => {
    const d = a.startTime.split("T")[0];
    return (
      d === dateStr && a.userId === auth.user?.id && a.status === "approved"
    );
  });
}

function dayHasOtherAlloc(dateStr: string): boolean {
  return allocStore.allocations.some((a) => {
    const d = a.startTime.split("T")[0];
    return (
      d === dateStr && a.userId !== auth.user?.id && a.status === "approved"
    );
  });
}

function isMyAllocation(a: Allocation): boolean {
  return a.userId === auth.user?.id;
}

function machineName(a: Allocation): string {
  return a.machine?.name ?? `Máquina #${a.machineId}`;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    approved: "Aprovada",
    pending: "Pendente",
    cancelled: "Cancelada",
    denied: "Negada",
    finished: "Finalizada",
  };
  return map[status] || status;
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    approved: "text-success",
    pending: "text-warning",
    cancelled: "text-muted",
    denied: "text-danger",
    finished: "text-secondary",
  };
  return map[status] || "";
}

async function handleCancel(id: number) {
  if (!confirm("Cancelar esta reserva?")) return;
  try {
    await allocStore.cancelAllocation(id);
  } catch {
    alert("Não foi possível cancelar a reserva.");
  }
}

// ---- Carrega dados ----
async function loadData() {
  await Promise.all([
    allocStore.fetchAllocations({ limit: 100 }),
    machinesStore.fetchMachines(),
  ]);
}

onMounted(loadData);

function handleCreated() {
  showNewModal.value = false;
  loadData();
}
</script>

<template>
  <div class="home">
    <!-- Header -->
    <div class="home-header">
      <div class="calendar-nav">
        <button class="btn btn-ghost btn-sm" @click="prevMonth">◄</button>
        <h2 class="month-title">
          {{ monthNames[currentMonth] }} {{ currentYear }}
        </h2>
        <button class="btn btn-ghost btn-sm" @click="nextMonth">►</button>
      </div>

      <select v-model="filterMachineId" class="filter-select">
        <option :value="null">Todas as máquinas</option>
        <option v-for="m in machinesStore.machines" :key="m.id" :value="m.id">
          {{ m.name }}
        </option>
      </select>
    </div>

    <!-- Calendário -->
    <div class="calendar">
      <div class="cal-header" v-for="d in weekDays" :key="d">{{ d }}</div>
      <template v-for="(cell, idx) in calendarDays" :key="idx">
        <div
          v-if="cell"
          class="cal-day"
          :class="{
            'cal-today': cell.date === formatDate(new Date()),
            'cal-selected': cell.date === selectedDate,
          }"
          @click="selectedDate = cell.date"
        >
          <span class="cal-day-num">{{ cell.day }}</span>
          <div class="cal-dots">
            <span v-if="dayHasMyAlloc(cell.date)" class="dot dot-mine"></span>
            <span
              v-if="dayHasOtherAlloc(cell.date)"
              class="dot dot-other"
            ></span>
          </div>
        </div>
        <div v-else class="cal-day cal-empty"></div>
      </template>
    </div>

    <!-- Legenda -->
    <div class="legend">
      <span class="legend-item"
        ><span class="dot dot-mine"></span> Suas reservas</span
      >
      <span class="legend-item"
        ><span class="dot dot-other"></span> Outros</span
      >
    </div>

    <!-- Detalhes do dia selecionado -->
    <div class="day-detail" v-if="selectedDate">
      <div class="day-detail-header">
        <h3>{{ formatDisplayDate(selectedDate) }}</h3>
        <button class="btn btn-primary btn-sm" @click="showNewModal = true">
          + Nova Reserva
        </button>
      </div>

      <div v-if="allocStore.loading" class="text-muted mt-1">Carregando...</div>

      <div v-else-if="dayAllocations.length === 0" class="empty-state">
        Nenhuma reserva para este dia.
      </div>

      <div v-else class="alloc-list">
        <div v-for="a in dayAllocations" :key="a.id" class="alloc-row">
          <span class="alloc-time"
            >{{ parseTime(a.startTime) }}–{{ parseTime(a.endTime) }}</span
          >
          <span class="alloc-machine">{{ machineName(a) }}</span>
          <span :class="statusClass(a.status)" class="alloc-status">
            {{ isMyAllocation(a) ? "Você" : (a.user?.fullName ?? "—") }}
          </span>
          <span :class="statusClass(a.status)" class="alloc-badge">{{
            statusLabel(a.status)
          }}</span>
          <button
            v-if="isMyAllocation(a) && a.status === 'approved'"
            class="btn btn-danger btn-sm"
            @click="handleCancel(a.id)"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal de nova reserva -->
  <NewAllocationModal
    v-if="showNewModal"
    :machines="machinesStore.machines"
    :selected-date="selectedDate"
    @close="showNewModal = false"
    @created="handleCreated"
  />
</template>

<style scoped>
.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.month-title {
  font-size: 1.4rem;
  font-weight: 700;
  min-width: 220px;
  text-align: center;
}

.filter-select {
  width: auto;
  min-width: 200px;
  padding: 0.55rem 0.85rem;
  font-size: 0.9rem;
}

/* ---- Calendário ---- */
.calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 1rem;
}

.cal-header {
  padding: 0.7rem 0;
  text-align: center;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-card);
  letter-spacing: 0.05em;
}

.cal-day {
  min-height: 72px;
  padding: 0.5rem;
  background: var(--bg-card);
  cursor: pointer;
  transition: background var(--transition);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.cal-day:hover {
  background: var(--bg-hover);
}
.cal-day.cal-empty {
  cursor: default;
  background: var(--bg-secondary);
}
.cal-day.cal-today .cal-day-num {
  background: var(--accent);
  color: #fff;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
}
.cal-day.cal-selected {
  background: var(--accent-soft);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.cal-day-num {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
}

.cal-dots {
  display: flex;
  gap: 3px;
  margin-top: auto;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot-mine {
  background: var(--accent);
}
.dot-other {
  background: var(--text-muted);
}

/* ---- Legenda ---- */
.legend {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

/* ---- Detalhe do dia ---- */
.day-detail {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
}

.day-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}
.day-detail-header h3 {
  font-size: 1.2rem;
  font-weight: 700;
}

.empty-state {
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

/* ---- Lista de alocações ---- */
.alloc-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.alloc-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  background: var(--bg-input);
  font-size: 0.95rem;
}

.alloc-time {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 110px;
  font-size: 1rem;
}
.alloc-machine {
  color: var(--text-secondary);
  flex: 1;
}
.alloc-status {
  flex: 1;
  font-size: 0.85rem;
}
.alloc-badge {
  font-size: 0.8rem;
  min-width: 80px;
  text-align: right;
}
</style>
