<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import { useAllocationsStore } from "@/stores/allocations";
import { useAuthStore } from "@/stores/auth";
import type { Machine, Allocation } from "@/types";
import { useRouter } from "vue-router";

const props = defineProps<{ id: string | number }>();
const machinesStore = useMachinesStore();
const allocationsStore = useAllocationsStore();
const auth = useAuthStore();
const router = useRouter();

const machine = ref<Machine | null>(null);
const scheduleAllocations = ref<Allocation[]>([]);
const loading = ref(true);
const showForm = ref(false);

const isAdmin = computed(() => auth.user?.role === "admin");

onMounted(async () => {
  try {
    const [m, sched] = await Promise.all([
      machinesStore.fetchMachine(Number(props.id)),
      machinesStore.fetchMachineAllocations(Number(props.id), { limit: 200 }),
    ]);
    machine.value = m;
    scheduleAllocations.value = sched.data || [];
  } catch {
    router.push({ name: "machines" });
  } finally {
    loading.value = false;
  }
});

/* ---- Inline form ---- */
const form = ref({
  date: "",
  startTime: "",
  endTime: "",
  reason: "",
});
const formSaving = ref(false);
const formError = ref("");

function openForm() {
  form.value = { date: "", startTime: "", endTime: "", reason: "" };
  formError.value = "";
  showForm.value = true;
}

function toLocalIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

async function handleCreate() {
  if (!machine.value) return;
  formError.value = "";
  if (!form.value.date || !form.value.startTime || !form.value.endTime) {
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
      machineId: machine.value.id,
      startTime: toLocalIso(form.value.date, form.value.startTime),
      endTime: toLocalIso(form.value.date, form.value.endTime),
      reason: form.value.reason || undefined,
    });
    showForm.value = false;
    await allocationsStore.fetchAllocations();
    const sched = await machinesStore.fetchMachineAllocations(
      Number(props.id),
      { limit: 200 },
    );
    scheduleAllocations.value = sched.data || [];
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

/* ---- Status helpers ---- */
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
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---- Weekly calendar ---- */
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

  return scheduleAllocations.value
    .filter((a) => {
      if (!["approved", "pending"].includes(a.status)) return false;
      const s = new Date(a.startTime);
      const e = new Date(a.endTime);
      return s <= dayEnd && e >= dayStart;
    })
    .map((a) => {
      const s = new Date(a.startTime);
      const e = new Date(a.endTime);
      const clampedStart = Math.max(s.getTime(), dayStart.getTime());
      const clampedEnd = Math.min(e.getTime(), dayEnd.getTime());

      const startHour =
        new Date(clampedStart).getHours() +
        new Date(clampedStart).getMinutes() / 60;
      const endHour =
        new Date(clampedEnd).getHours() +
        new Date(clampedEnd).getMinutes() / 60;

      const top =
        ((Math.max(startHour, HOURS_START) - HOURS_START) /
          (HOURS_END - HOURS_START + 1)) *
        100;
      const height =
        ((Math.min(endHour, HOURS_END + 1) - Math.max(startHour, HOURS_START)) /
          (HOURS_END - HOURS_START + 1)) *
        100;

      const timeLabel = `${fmtTime(a.startTime)} - ${fmtTime(a.endTime)}`;
      // Admin sees user names, regular user sees only time
      const userName = a.user?.fullName;

      return {
        allocation: a,
        top: `${top}%`,
        height: `${Math.max(height, 1.5)}%`,
        isPending: a.status === "pending",
        timeLabel,
        label: userName ? `${userName} · ${timeLabel}` : timeLabel,
      };
    });
}
</script>

<template>
  <div class="fade-in">
    <button
      class="btn btn-ghost btn-sm"
      style="margin-bottom: 1rem"
      @click="router.push({ name: 'machines' })"
    >
      ← Voltar
    </button>

    <div v-if="loading" class="empty-state">Carregando...</div>

    <template v-else-if="machine">
      <div class="detail-header">
        <div>
          <h1 class="page-title" style="margin-bottom: 0.25rem">
            {{ machine.name }}
          </h1>
          <p class="text-secondary" style="font-size: 0.9rem">
            {{ machine.description || "Sem descrição" }}
          </p>
        </div>
        <div style="display: flex; gap: 0.75rem; align-items: center">
          <span
            :class="['badge', statusBadge(machine.status)]"
            style="font-size: 0.85rem; padding: 0.35rem 0.9rem"
          >
            {{ statusLabel(machine.status) }}
          </span>
          <button
            v-if="machine.status !== 'maintenance'"
            class="btn btn-primary btn-sm"
            @click="openForm"
          >
            + Reservar
          </button>
        </div>
      </div>

      <!-- Specs grid -->
      <div class="specs-grid">
        <div class="stat-card" v-if="machine.cpuModel">
          <span class="stat-label">CPU</span>
          <span class="stat-value" style="font-size: 1rem">{{
            machine.cpuModel
          }}</span>
        </div>
        <div class="stat-card" v-if="machine.gpuModel">
          <span class="stat-label">GPU</span>
          <span class="stat-value" style="font-size: 1rem">{{
            machine.gpuModel
          }}</span>
        </div>
        <div class="stat-card" v-if="machine.totalRamGb">
          <span class="stat-label">RAM</span>
          <span class="stat-value">{{ machine.totalRamGb }} GB</span>
        </div>
        <div class="stat-card" v-if="machine.totalDiskGb">
          <span class="stat-label">Disco</span>
          <span class="stat-value">{{ machine.totalDiskGb }} GB</span>
        </div>
        <div class="stat-card" v-if="machine.ipAddress">
          <span class="stat-label">IP</span>
          <span class="stat-value" style="font-size: 1rem">{{
            machine.ipAddress
          }}</span>
        </div>
        <div class="stat-card" v-if="isAdmin && machine.macAddress">
          <span class="stat-label">MAC</span>
          <span class="stat-value" style="font-size: 0.92rem">{{
            machine.macAddress
          }}</span>
        </div>
      </div>

      <!-- Telemetry if available -->
      <template v-if="machine.latestTelemetry">
        <h2 class="section-title">Telemetria em Tempo Real</h2>
        <div class="telemetry-grid">
          <div class="tele-item">
            <span class="tele-label">CPU</span>
            <div
              class="progress-bar"
              :class="
                machine.latestTelemetry.cpuUsage > 80
                  ? 'danger'
                  : machine.latestTelemetry.cpuUsage > 50
                    ? 'warning'
                    : 'success'
              "
            >
              <div
                class="progress-fill"
                :style="{ width: machine.latestTelemetry.cpuUsage + '%' }"
              ></div>
            </div>
            <span class="tele-val"
              >{{ machine.latestTelemetry.cpuUsage.toFixed(0) }}% ·
              {{ machine.latestTelemetry.cpuTemp.toFixed(0) }}°C</span
            >
          </div>
          <div class="tele-item">
            <span class="tele-label">GPU</span>
            <div
              class="progress-bar"
              :class="
                machine.latestTelemetry.gpuUsage > 80
                  ? 'danger'
                  : machine.latestTelemetry.gpuUsage > 50
                    ? 'warning'
                    : 'success'
              "
            >
              <div
                class="progress-fill"
                :style="{ width: machine.latestTelemetry.gpuUsage + '%' }"
              ></div>
            </div>
            <span class="tele-val"
              >{{ machine.latestTelemetry.gpuUsage.toFixed(0) }}% ·
              {{ machine.latestTelemetry.gpuTemp.toFixed(0) }}°C</span
            >
          </div>
          <div class="tele-item">
            <span class="tele-label">RAM</span>
            <div
              class="progress-bar"
              :class="
                machine.latestTelemetry.ramUsage > 80
                  ? 'danger'
                  : machine.latestTelemetry.ramUsage > 50
                    ? 'warning'
                    : 'success'
              "
            >
              <div
                class="progress-fill"
                :style="{ width: machine.latestTelemetry.ramUsage + '%' }"
              ></div>
            </div>
            <span class="tele-val"
              >{{ machine.latestTelemetry.ramUsage.toFixed(0) }}%</span
            >
          </div>
        </div>
      </template>

      <!-- ======== Calendar + Form Row ======== -->
      <h2 class="section-title">Agenda Semanal</h2>

      <div class="layout-row" :class="{ 'with-panel': showForm }">
        <!-- Calendar -->
        <section class="layout-calendar">
          <div class="cal-toolbar">
            <div class="cal-nav">
              <button class="btn btn-ghost btn-sm" @click="weekOffset--">
                ←
              </button>
              <span class="cal-week-label"
                >{{ fmtDayLabel(weekDays[0]) }} —
                {{ fmtDayLabel(weekDays[6]) }}</span
              >
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
                <div
                  class="cal-day-header"
                  :class="{ 'is-today': isToday(day) }"
                >
                  {{ fmtDayLabel(day) }}
                </div>
                <div class="cal-day-body">
                  <div v-for="h in hours" :key="h" class="cal-hour-line"></div>
                  <div
                    v-for="(block, bi) in blocksForDay(day)"
                    :key="bi"
                    class="cal-block"
                    :class="{ pending: block.isPending }"
                    :style="{ top: block.top, height: block.height }"
                    :title="block.label"
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
              <h2 class="panel-title">Reservar {{ machine.name }}</h2>
              <button class="btn-close" @click="showForm = false">✕</button>
            </div>
            <form class="panel-body" @submit.prevent="handleCreate">
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
    </template>
  </div>
</template>

<style scoped>
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.specs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
  margin-top: 0.5rem;
}

.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}
.tele-item {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.tele-label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.tele-val {
  font-size: 0.82rem;
  color: var(--text-secondary);
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
  left: 2px;
  right: 2px;
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

@media (max-width: 900px) {
  .layout-row {
    flex-direction: column;
  }
  .layout-panel {
    width: 100%;
  }
}
</style>
