<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useAllocationsStore } from "@/stores/allocations";
import { useMachinesStore } from "@/stores/machines";
import { useAuthStore } from "@/stores/auth";
import type { Allocation, AllocationMetric } from "@/types";

const allocationsStore = useAllocationsStore();
const machinesStore = useMachinesStore();
const auth = useAuthStore();

const isAdmin = computed(() => auth.user?.role === "admin");

const loading = ref(true);
const showForm = ref(false);

/* ---- Machine filter ---- */
const machineFilter = ref<number | "all">("all");

/* ---- Week calendar state ---- */
const weekOffset = ref(0);
const HOURS_START = 7;
const HOURS_END = 23;

const today = new Date();
today.setHours(0, 0, 0, 0);

const weekStart = computed(() => {
  const d = new Date(today);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff + weekOffset.value * 7);
  return d;
});

const weekDays = computed(() => {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.value);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
});

const hours = computed(() => {
  const h: number[] = [];
  for (let i = HOURS_START; i <= HOURS_END; i++) h.push(i);
  return h;
});

function fmtDayLabel(d: Date) {
  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  return `${names[d.getDay()]} ${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

function isToday(d: Date) {
  const t = new Date();
  return (
    d.getDate() === t.getDate() &&
    d.getMonth() === t.getMonth() &&
    d.getFullYear() === t.getFullYear()
  );
}

/* ---- Allocations mapped to calendar ---- */
const calendarAllocations = ref<Allocation[]>([]);
const loadingCalendar = ref(false);

async function loadCalendarAllocations() {
  loadingCalendar.value = true;
  try {
    if (machineFilter.value === "all") {
      const promises = machinesStore.machines.map((m) =>
        machinesStore.fetchMachineAllocations(m.id, { limit: 100 }),
      );
      const results = await Promise.all(promises);
      calendarAllocations.value = results.flatMap((r) => r.data || []);
    } else {
      const result = await machinesStore.fetchMachineAllocations(
        machineFilter.value,
        { limit: 100 },
      );
      calendarAllocations.value = result.data || [];
    }
  } finally {
    loadingCalendar.value = false;
  }
}

function blocksForDay(day: Date) {
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    0,
    0,
    0,
  );
  const dayEnd = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    23,
    59,
    59,
    999,
  );

  const filtered = calendarAllocations.value.filter((a) => {
    if (!["approved", "pending"].includes(a.status)) return false;
    const s = new Date(a.startTime);
    const e = new Date(a.endTime);
    return s <= dayEnd && e >= dayStart;
  });

  // Calcula posição vertical de cada bloco
  const items = filtered.map((a) => {
    const s = new Date(a.startTime);
    const e = new Date(a.endTime);
    const clampedStart = Math.max(s.getTime(), dayStart.getTime());
    const clampedEnd = Math.min(e.getTime(), dayEnd.getTime());

    const startHour =
      new Date(clampedStart).getHours() +
      new Date(clampedStart).getMinutes() / 60;
    const endHour =
      new Date(clampedEnd).getHours() + new Date(clampedEnd).getMinutes() / 60;

    const topPct =
      ((Math.max(startHour, HOURS_START) - HOURS_START) /
        (HOURS_END - HOURS_START + 1)) *
      100;
    const heightPct =
      ((Math.min(endHour, HOURS_END + 1) - Math.max(startHour, HOURS_START)) /
        (HOURS_END - HOURS_START + 1)) *
      100;

    const mn = machinesStore.machines.find((m) => m.id === a.machineId);
    const machineName = mn ? mn.name : `#${a.machineId}`;
    const userName = a.user?.fullName;
    const label =
      isAdmin.value && userName ? `${userName} — ${machineName}` : machineName;

    return {
      allocation: a,
      topPct,
      heightPct,
      startH: Math.max(startHour, HOURS_START),
      endH: Math.min(endHour, HOURS_END + 1),
      label,
      isPending: a.status === "pending",
      col: 0,
      totalCols: 1,
    };
  });

  // Ordena por início, depois por duração descendente (maior primeiro)
  items.sort(
    (a, b) => a.startH - b.startH || b.endH - b.startH - (a.endH - a.startH),
  );

  // Atribuição de colunas: para cada item, encontra a primeira coluna livre
  for (let i = 0; i < items.length; i++) {
    const occupied = new Set<number>();
    for (let j = 0; j < i; j++) {
      // j sobrepõe i?
      if (items[j].startH < items[i].endH && items[j].endH > items[i].startH) {
        occupied.add(items[j].col);
      }
    }
    let c = 0;
    while (occupied.has(c)) c++;
    items[i].col = c;
  }

  // Agrupa itens conectados por sobreposição para definir totalCols do grupo
  const visited = new Array(items.length).fill(false);
  for (let i = 0; i < items.length; i++) {
    if (visited[i]) continue;
    // BFS para encontrar todos os itens conectados transitivamente
    const group: number[] = [];
    const queue = [i];
    visited[i] = true;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      group.push(cur);
      for (let j = 0; j < items.length; j++) {
        if (visited[j]) continue;
        if (
          items[j].startH < items[cur].endH &&
          items[j].endH > items[cur].startH
        ) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }
    const maxCol = Math.max(...group.map((idx) => items[idx].col)) + 1;
    for (const idx of group) {
      items[idx].totalCols = maxCol;
    }
  }

  return items.map((item) => ({
    allocation: item.allocation,
    top: `${item.topPct}%`,
    height: `${Math.max(item.heightPct, 1.5)}%`,
    left: `${(item.col / item.totalCols) * 100}%`,
    width: `${(1 / item.totalCols) * 100}%`,
    label: item.label,
    isPending: item.isPending,
  }));
}

watch(machineFilter, () => loadCalendarAllocations());

onMounted(async () => {
  try {
    await Promise.all([
      allocationsStore.fetchAllocations(
        auth.user ? { userId: auth.user.id } : undefined,
      ),
      machinesStore.fetchMachines(),
    ]);
    await loadCalendarAllocations();
  } finally {
    loading.value = false;
  }
});

/* ---- Inline form ---- */
const form = ref({
  machineId: "" as string | number,
  date: "",
  startTime: "",
  endTime: "",
  reason: "",
});
const formSaving = ref(false);
const formError = ref("");

function openForm() {
  form.value = {
    machineId: "",
    date: "",
    startTime: "",
    endTime: "",
    reason: "",
  };
  formError.value = "";
  showForm.value = true;
}

function toLocalIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

async function handleCreate() {
  formError.value = "";
  if (
    !form.value.machineId ||
    !form.value.date ||
    !form.value.startTime ||
    !form.value.endTime
  ) {
    formError.value = "Preencha todos os campos obrigatórios.";
    return;
  }
  if (form.value.startTime >= form.value.endTime) {
    formError.value = "Horário de início deve ser antes do fim.";
    return;
  }
  formSaving.value = true;
  try {
    await allocationsStore.createAllocation({
      machineId: Number(form.value.machineId),
      startTime: toLocalIso(form.value.date, form.value.startTime),
      endTime: toLocalIso(form.value.date, form.value.endTime),
      reason: form.value.reason || undefined,
    });
    showForm.value = false;
    await Promise.all([
      allocationsStore.fetchAllocations(
        auth.user ? { userId: auth.user.id } : undefined,
      ),
      loadCalendarAllocations(),
    ]);
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 409)
      formError.value = "Conflito de horário com outra reserva.";
    else if (status === 422)
      formError.value = "Dados inválidos. Verifique os campos.";
    else formError.value = "Erro ao criar reserva.";
  } finally {
    formSaving.value = false;
  }
}

/* ---- My allocations list ---- */
const statusFilter = ref("all");

const filtered = computed(() => {
  if (statusFilter.value === "all") return allocationsStore.allocations;
  return allocationsStore.allocations.filter(
    (a) => a.status === statusFilter.value,
  );
});

function machineName(a: Allocation): string {
  if (a.machine) return a.machine.name;
  const m = machinesStore.machines.find((m) => m.id === a.machineId);
  return m ? m.name : `Máquina #${a.machineId}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtRange(start: string, end: string) {
  return `${fmtDate(start)} ${fmtTime(start)} — ${fmtTime(end)}`;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    pending: "badge-warning",
    approved: "badge-success",
    denied: "badge-danger",
    cancelled: "badge-muted",
    finished: "badge-info",
  };
  return map[s] || "badge-muted";
}
function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovada",
    denied: "Negada",
    cancelled: "Cancelada",
    finished: "Finalizada",
  };
  return map[s] || s;
}

const cancelling = ref<number | null>(null);
async function handleCancel(id: number) {
  if (!confirm("Cancelar esta reserva?")) return;
  cancelling.value = id;
  try {
    await allocationsStore.cancelAllocation(id);
  } finally {
    cancelling.value = null;
  }
}

const deleting = ref<number | null>(null);
async function handleDelete(id: number) {
  if (!confirm("Remover esta reserva do seu histórico?")) return;
  deleting.value = id;
  try {
    await allocationsStore.softDeleteAllocation(id);
  } finally {
    deleting.value = null;
  }
}

function canCancel(a: Allocation) {
  return ["pending", "approved"].includes(a.status);
}
function canDelete(a: Allocation) {
  return ["cancelled", "denied", "finished"].includes(a.status);
}

/* ---- Stats modal ---- */
const statsModal = ref(false);
const statsAllocation = ref<Allocation | null>(null);
const statsData = ref<AllocationMetric | null>(null);
const statsLoading = ref(false);
const statsError = ref("");

async function openStats(a: Allocation) {
  if (a.status !== "finished") return;
  statsAllocation.value = a;
  statsData.value = null;
  statsError.value = "";
  statsModal.value = true;
  statsLoading.value = true;
  try {
    statsData.value = await allocationsStore.fetchAllocationSummary(a.id);
  } catch (err: any) {
    const code = err.response?.data?.code;
    if (code === "NO_SUMMARY")
      statsError.value = "Esta alocação ainda não foi resumida.";
    else statsError.value = "Erro ao carregar estatísticas.";
  } finally {
    statsLoading.value = false;
  }
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Reservas</h1>
      <button class="btn btn-primary" @click="openForm">+ Nova Reserva</button>
    </div>

    <!-- ======== Calendar + Form Row ======== -->
    <div class="layout-row" :class="{ 'with-panel': showForm }">
      <!-- Calendar -->
      <section class="layout-calendar">
        <div class="cal-toolbar">
          <div class="cal-nav">
            <button class="btn btn-ghost btn-sm" @click="weekOffset--">
              ←
            </button>
            <span class="cal-week-label">
              {{ fmtDayLabel(weekDays[0]) }} — {{ fmtDayLabel(weekDays[6]) }}
            </span>
            <button class="btn btn-ghost btn-sm" @click="weekOffset++">
              →
            </button>
            <button
              v-if="weekOffset !== 0"
              class="btn btn-ghost btn-sm"
              @click="weekOffset = 0"
            >
              Hoje
            </button>
          </div>
          <div class="cal-filter">
            <select
              v-model="machineFilter"
              style="
                max-width: 220px;
                padding: 0.45rem 0.75rem;
                font-size: 0.85rem;
              "
            >
              <option value="all">Todas as máquinas</option>
              <option
                v-for="m in machinesStore.machines"
                :key="m.id"
                :value="m.id"
              >
                {{ m.name }}
              </option>
            </select>
          </div>
        </div>

        <div class="cal-grid-wrap">
          <div
            class="cal-grid"
            :style="{ '--total-hours': HOURS_END - HOURS_START + 1 }"
          >
            <div class="cal-hours-col">
              <div class="cal-corner"></div>
              <div v-for="h in hours" :key="h" class="cal-hour-label">
                {{ String(h).padStart(2, "0") }}:00
              </div>
            </div>
            <div
              v-for="day in weekDays"
              :key="day.toISOString()"
              class="cal-day-col"
              :class="{ 'is-today': isToday(day) }"
            >
              <div class="cal-day-header" :class="{ 'is-today': isToday(day) }">
                {{ fmtDayLabel(day) }}
              </div>
              <div class="cal-day-body">
                <div v-for="h in hours" :key="h" class="cal-hour-line"></div>
                <div
                  v-for="(block, bi) in blocksForDay(day)"
                  :key="bi"
                  class="cal-block"
                  :class="{ pending: block.isPending }"
                  :style="{
                    top: block.top,
                    height: block.height,
                    left: block.left,
                    width: block.width,
                  }"
                  :title="`${block.label} — ${fmtTime(block.allocation.startTime)} - ${fmtTime(block.allocation.endTime)}`"
                >
                  <span class="cal-block-text">{{ block.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Inline Allocation Form Panel -->
      <aside v-if="showForm" class="layout-panel fade-in">
        <div class="panel-card">
          <div class="panel-header">
            <h2 class="panel-title">Nova Reserva</h2>
            <button class="btn-close" @click="showForm = false">✕</button>
          </div>
          <form class="panel-body" @submit.prevent="handleCreate">
            <div class="field">
              <label class="field-label">Máquina</label>
              <select v-model="form.machineId">
                <option value="" disabled>Selecione...</option>
                <option
                  v-for="m in machinesStore.machines.filter(
                    (m) => m.status !== 'maintenance',
                  )"
                  :key="m.id"
                  :value="m.id"
                >
                  {{ m.name }} —
                  {{
                    m.status === "available"
                      ? "🟢 Disponível"
                      : m.status === "occupied"
                        ? "🟡 Ocupada"
                        : "🔴 Offline"
                  }}
                </option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">Data</label>
              <input v-model="form.date" type="date" />
            </div>
            <div class="field-row">
              <div class="field">
                <label class="field-label">Início</label>
                <input v-model="form.startTime" type="time" />
              </div>
              <div class="field">
                <label class="field-label">Fim</label>
                <input v-model="form.endTime" type="time" />
              </div>
            </div>
            <div class="field">
              <label class="field-label"
                >Motivo <span class="text-muted">(opcional)</span></label
              >
              <textarea
                v-model="form.reason"
                rows="2"
                placeholder="Ex: Treinamento de modelo ML"
              ></textarea>
            </div>
            <p v-if="formError" class="error-text">{{ formError }}</p>
            <div class="panel-actions">
              <button
                type="button"
                class="btn btn-ghost"
                @click="showForm = false"
              >
                Cancelar
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="formSaving"
              >
                {{ formSaving ? "Criando..." : "Criar Reserva" }}
              </button>
            </div>
          </form>
        </div>
      </aside>
    </div>

    <!-- ======== My Allocations List ======== -->
    <section style="margin-top: 2rem">
      <h2 class="section-title">Minhas Reservas</h2>
      <div class="filter-tabs">
        <button
          v-for="opt in [
            { key: 'all', label: 'Todas' },
            { key: 'pending', label: 'Pendentes' },
            { key: 'approved', label: 'Aprovadas' },
            { key: 'finished', label: 'Finalizadas' },
          ]"
          :key="opt.key"
          :class="['tab-btn', { active: statusFilter === opt.key }]"
          @click="statusFilter = opt.key"
        >
          {{ opt.label }}
        </button>
      </div>

      <div v-if="loading" class="empty-state">Carregando...</div>
      <div v-else-if="filtered.length === 0" class="empty-state">
        Nenhuma reserva
        {{ statusFilter !== "all" ? "com esse filtro" : "encontrada" }}.
      </div>

      <div v-else class="alloc-grid">
        <div
          v-for="a in filtered"
          :key="a.id"
          class="card alloc-card"
          :class="{ clickable: a.status === 'finished' }"
          @click="a.status === 'finished' ? openStats(a) : undefined"
        >
          <div class="alloc-top">
            <span class="alloc-machine">{{ machineName(a) }}</span>
            <span :class="['badge', statusBadge(a.status)]">{{
              statusLabel(a.status)
            }}</span>
          </div>
          <div class="alloc-time">{{ fmtRange(a.startTime, a.endTime) }}</div>
          <div v-if="a.reason" class="alloc-reason">{{ a.reason }}</div>
          <div class="alloc-bottom">
            <span class="text-muted" style="font-size: 0.78rem">
              Criada em {{ fmtDate(a.createdAt) }}
            </span>
            <div style="display: flex; gap: 0.35rem; align-items: center">
              <span
                v-if="a.status === 'finished'"
                class="text-info"
                style="font-size: 0.78rem; cursor: pointer"
                >Ver estatísticas →</span
              >
              <button
                v-if="canCancel(a)"
                class="btn btn-danger btn-sm"
                :disabled="cancelling === a.id"
                @click.stop="handleCancel(a.id)"
              >
                {{ cancelling === a.id ? "..." : "Cancelar" }}
              </button>
              <button
                v-if="canDelete(a)"
                class="btn btn-ghost btn-sm"
                :disabled="deleting === a.id"
                @click.stop="handleDelete(a.id)"
              >
                {{ deleting === a.id ? "..." : "Remover" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ======== Stats Modal ======== -->
    <Teleport to="body">
      <div
        v-if="statsModal"
        class="modal-overlay"
        @click.self="statsModal = false"
      >
        <div class="modal-glass fade-in" style="max-width: 520px">
          <div class="modal-header">
            <h2 class="modal-title">Estatísticas de Uso</h2>
            <button class="btn-close" @click="statsModal = false">✕</button>
          </div>
          <div class="modal-body">
            <div v-if="statsAllocation" style="margin-bottom: 0.75rem">
              <span style="font-weight: 600">{{
                machineName(statsAllocation)
              }}</span>
              <span
                class="text-secondary"
                style="margin-left: 0.5rem; font-size: 0.85rem"
              >
                {{
                  fmtRange(statsAllocation.startTime, statsAllocation.endTime)
                }}
              </span>
            </div>
            <div v-if="statsLoading" class="empty-state" style="padding: 2rem">
              Carregando...
            </div>
            <div
              v-else-if="statsError"
              class="empty-state"
              style="padding: 2rem"
            >
              {{ statsError }}
            </div>
            <div v-else-if="statsData" class="stats-grid">
              <div class="stat-mini">
                <span class="stat-mini-label">Duração</span>
                <span class="stat-mini-val"
                  >{{ statsData.sessionDurationMinutes }} min</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">CPU Média</span>
                <span class="stat-mini-val"
                  >{{ statsData.avgCpuUsage.toFixed(1) }}%</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">CPU Máx</span>
                <span class="stat-mini-val"
                  >{{ statsData.maxCpuUsage.toFixed(1) }}%</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">CPU Temp Máx</span>
                <span class="stat-mini-val"
                  >{{ statsData.maxCpuTemp.toFixed(0) }}°C</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">GPU Média</span>
                <span class="stat-mini-val"
                  >{{ statsData.avgGpuUsage.toFixed(1) }}%</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">GPU Máx</span>
                <span class="stat-mini-val"
                  >{{ statsData.maxGpuUsage.toFixed(1) }}%</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">GPU Temp Máx</span>
                <span class="stat-mini-val"
                  >{{ statsData.maxGpuTemp.toFixed(0) }}°C</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">RAM Média</span>
                <span class="stat-mini-val"
                  >{{ statsData.avgRamUsage.toFixed(1) }}%</span
                >
              </div>
              <div class="stat-mini">
                <span class="stat-mini-label">RAM Máx</span>
                <span class="stat-mini-val"
                  >{{ statsData.maxRamUsage.toFixed(1) }}%</span
                >
              </div>
              <div v-if="statsData.avgDiskUsage != null" class="stat-mini">
                <span class="stat-mini-label">Disco Média</span>
                <span class="stat-mini-val"
                  >{{ statsData.avgDiskUsage.toFixed(1) }}%</span
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

/* ---- Side-by-side layout ---- */
.layout-row {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
  justify-content: center;
}
.layout-calendar {
  flex: 1;
  min-width: 0;
  transition: all 0.3s ease;
}
.layout-row.with-panel .layout-calendar {
  flex: 1 1 0;
}
.layout-panel {
  width: 360px;
  flex-shrink: 0;
}

.panel-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  position: sticky;
  top: 80px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}
.panel-title {
  font-size: 1.05rem;
  font-weight: 600;
}
.panel-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

/* ---- Calendar ---- */
.cal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.cal-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.cal-week-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 200px;
  text-align: center;
}

.cal-grid-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}

.cal-grid {
  display: grid;
  grid-template-columns: 60px repeat(7, 1fr);
  min-width: 700px;
}

.cal-hours-col {
  border-right: 1px solid var(--border-subtle);
}
.cal-corner {
  height: 36px;
  border-bottom: 1px solid var(--border-subtle);
}
.cal-hour-label {
  height: 40px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 2px 6px 0 0;
  font-size: 0.68rem;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
}

.cal-day-col {
  border-right: 1px solid var(--border-subtle);
}
.cal-day-col:last-child {
  border-right: none;
}
.cal-day-col.is-today {
  background: rgba(124, 108, 240, 0.03);
}

.cal-day-header {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.cal-day-header.is-today {
  color: var(--accent);
}

.cal-day-body {
  position: relative;
  height: calc(var(--total-hours) * 40px);
}
.cal-hour-line {
  height: 40px;
  border-bottom: 1px solid var(--border-subtle);
}

.cal-block {
  position: absolute;
  box-sizing: border-box;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.35),
    rgba(155, 109, 255, 0.3)
  );
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  padding: 2px 4px;
  overflow: hidden;
  z-index: 2;
  cursor: default;
  transition: background var(--transition);
}
.cal-block:hover {
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.5),
    rgba(155, 109, 255, 0.45)
  );
}
.cal-block.pending {
  background: linear-gradient(
    135deg,
    rgba(251, 191, 36, 0.2),
    rgba(251, 191, 36, 0.15)
  );
  border-left-color: var(--warning);
}
.cal-block-text {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

/* ---- Filter tabs ---- */
.filter-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 0.4rem 0.9rem;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  transition: all var(--transition);
}
.tab-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.tab-btn.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: rgba(124, 108, 240, 0.15);
}

/* ---- Alloc grid ---- */
.alloc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 1rem;
}
.alloc-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.alloc-card.clickable {
  cursor: pointer;
}
.alloc-card.clickable:hover {
  border-color: rgba(96, 165, 250, 0.25);
}
.alloc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.alloc-machine {
  font-weight: 600;
  font-size: 1rem;
}
.alloc-time {
  font-size: 0.88rem;
  color: var(--text-secondary);
}
.alloc-reason {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
}
.alloc-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.25rem;
}

/* ---- Stats modal ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}
.modal-glass {
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated);
  width: 100%;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}
.modal-title {
  font-size: 1.1rem;
  font-weight: 600;
}
.modal-body {
  padding: 1.5rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.75rem;
}
.stat-mini {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 0.65rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.stat-mini-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.stat-mini-val {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

@media (max-width: 900px) {
  .layout-row {
    flex-direction: column;
  }
  .layout-panel {
    width: 100%;
  }
}
</style>
