<script setup lang="ts">
import { ref, watch } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { DiskPartition, Machine } from "@/types";
import { applyMainDiskSelection, partitionRoleLabel } from "@/utils/machineDisks";

const props = defineProps<{ machine: Machine }>();

const emit = defineEmits<{ saved: [machine: Machine] }>();

const store = useMachinesStore();
const saving = ref(false);
const error = ref("");

const onlyMainDisk = ref(false);
const disks = ref<DiskPartition[]>([]);

const diskPolicyModes = [
  {
    id: "main-only" as const,
    title: "Disco único",
    description: "Usuário não pode escolher outros discos.",
  },
  {
    id: "multi" as const,
    title: "Multidisco",
    description: "Usuário pode escolher os discos selecionados abaixo.",
  },
];

function loadFromMachine(m: Machine) {
  onlyMainDisk.value = Boolean(m.onlyMainDisk);
  disks.value = (m.disks ?? []).map((d, index) => ({
    ...d,
    id: d.id ?? index,
    role: d.role ?? "user",
    mainDisk: Boolean(d.mainDisk),
    allocatable: (d.role ?? "user") === "user" ? d.allocatable !== false : false,
  }));
}

loadFromMachine(props.machine);

watch(
  () => props.machine,
  (m) => loadFromMachine(m),
  { deep: true },
);

function setDiskPolicyMode(mode: "main-only" | "multi") {
  onlyMainDisk.value = mode === "main-only";
}

function setMainDisk(mountpoint: string) {
  disks.value = applyMainDiskSelection(disks.value, mountpoint);
}

function setAllocatable(mountpoint: string, value: boolean) {
  disks.value = disks.value.map((d) => {
    if (d.mountpoint !== mountpoint || (d.role ?? "user") !== "user") return d;
    if (d.mainDisk) return { ...d, allocatable: true };
    return { ...d, allocatable: value };
  });
}

async function handleSave() {
  saving.value = true;
  error.value = "";
  try {
    const updated = await store.updateMachine(props.machine.id, {
      onlyMainDisk: onlyMainDisk.value,
      disks: disks.value.map(({ id: _id, ...rest }) => rest),
    });
    loadFromMachine(updated);
    emit("saved", updated);
  } catch {
    error.value = "Não foi possível salvar a política de discos.";
  } finally {
    saving.value = false;
  }
}

const userDisks = () => disks.value.filter((d) => (d.role ?? "user") === "user");
</script>

<template>
  <div class="disks-tab">
    <p class="tab-hint text-secondary">
      Capacidade (livre/total) é capturada pelo agente via sync-specs e telemetria — não editável
      aqui. Defina o <strong>disco principal</strong>, quais volumes aparecem na reserva e se
      alocações ficam restritas ao principal.
    </p>

    <div class="policy-mode-grid">
      <label
        v-for="mode in diskPolicyModes"
        :key="mode.id"
        class="metric-toggle policy-mode-card"
        :class="{ 'is-checked': onlyMainDisk === (mode.id === 'main-only') }"
      >
        <input
          type="radio"
          name="diskPolicyMode"
          class="metric-toggle-input"
          :checked="onlyMainDisk === (mode.id === 'main-only')"
          @change="setDiskPolicyMode(mode.id)"
        />
        <span class="metric-toggle-box" aria-hidden="true" />
        <span class="policy-mode-text">
          <strong class="policy-mode-title">{{ mode.title }}</strong>
          <span class="policy-mode-desc">{{ mode.description }}</span>
        </span>
      </label>
    </div>

    <div v-if="userDisks().length === 0" class="empty-state">
      Nenhuma partição de user-space reportada. Aguarde sync-specs do agente.
    </div>

    <div v-else class="disk-policy-table">
      <div class="disk-policy-header">
        <span class="disk-policy-cell">Partição</span>
        <span class="disk-policy-cell">Tipo</span>
        <span class="disk-policy-cell">Capacidade</span>
        <span class="disk-policy-cell disk-policy-cell--action">Principal</span>
        <span class="disk-policy-cell disk-policy-cell--action">Reserva</span>
      </div>
      <div v-for="(d, i) in disks" :key="`${d.device}-${d.mountpoint}-${i}`" class="disk-policy-row">
        <span class="disk-policy-cell">
          <code>{{ d.mountpoint }}</code>
          <small class="text-muted">{{ d.device }}</small>
        </span>
        <span class="disk-policy-cell">
          <span
            class="badge"
            :class="d.role === 'system' ? 'badge-muted' : 'badge-success'"
          >
            {{ partitionRoleLabel(d.role) }}
          </span>
        </span>
        <span class="disk-policy-cell text-secondary capacity-cell">
          <span>{{ d.freeGb != null ? `${d.freeGb} GB livre` : "— livre" }}</span>
          <span class="capacity-total-readonly">
            {{ d.totalGb != null ? `${d.totalGb} GB total` : "— total" }}
          </span>
        </span>
        <span class="disk-policy-cell disk-policy-cell--action">
          <label
            v-if="(d.role ?? 'user') === 'user'"
            class="disk-control-toggle"
            :title="`Definir ${d.mountpoint} como disco principal`"
          >
            <input
              type="radio"
              name="mainDisk"
              class="metric-toggle-input"
              :checked="d.mainDisk"
              :aria-label="`Disco principal: ${d.mountpoint}`"
              @change="setMainDisk(d.mountpoint)"
            />
            <span class="metric-toggle-box" aria-hidden="true" />
          </label>
          <span v-else class="disk-policy-dash">—</span>
        </span>
        <span class="disk-policy-cell disk-policy-cell--action">
          <template v-if="(d.role ?? 'user') === 'user'">
            <span v-if="onlyMainDisk && !d.mainDisk" class="disk-policy-dash">—</span>
            <span
              v-else-if="d.mainDisk"
              class="disk-control-toggle is-disabled"
              title="Disco principal — sempre oferecido na reserva"
            >
              <span class="metric-toggle-box is-checked-static" aria-hidden="true" />
            </span>
            <label
              v-else
              class="disk-control-toggle"
              :title="`Oferecer ${d.mountpoint} na reserva`"
            >
              <input
                type="checkbox"
                class="metric-toggle-input"
                :checked="d.allocatable !== false"
                :aria-label="`Oferecer na reserva: ${d.mountpoint}`"
                @change="setAllocatable(d.mountpoint, ($event.target as HTMLInputElement).checked)"
              />
              <span class="metric-toggle-box" aria-hidden="true" />
            </label>
          </template>
          <span v-else class="disk-policy-dash">—</span>
        </span>
      </div>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>

    <button type="button" class="btn btn-primary" :disabled="saving" @click="handleSave">
      {{ saving ? "Salvando…" : "Salvar política de discos" }}
    </button>
  </div>
</template>

<style scoped>
.disks-tab {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 920px;
}

.tab-hint {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
}

.policy-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.policy-mode-card {
  align-items: flex-start;
  min-height: 4.25rem;
  padding: 0.7rem 0.75rem;
}

.policy-mode-card.is-checked {
  border-color: rgba(124, 108, 240, 0.45);
  background: var(--bg-card-solid);
  color: var(--text-primary);
}

.policy-mode-card:hover {
  background: var(--bg-hover);
}

.policy-mode-card.is-checked:hover {
  background: var(--bg-hover);
}

.policy-mode-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.policy-mode-title {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-primary);
}

.policy-mode-desc {
  font-size: 0.72rem;
  font-weight: 400;
  color: var(--text-muted);
  line-height: 1.35;
}

.disk-policy-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
}

.disk-policy-header,
.disk-policy-row {
  display: grid;
  grid-template-columns: 1.3fr 0.65fr 0.95fr 0.55fr 0.55fr;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  align-items: center;
  font-size: 0.82rem;
}

.disk-policy-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  min-width: 0;
}

.disk-policy-cell--action {
  flex-direction: row;
}

.disk-policy-dash {
  color: var(--text-muted);
  line-height: 1;
}

.disk-policy-header {
  background: var(--bg-card-solid);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
}

.disk-policy-row {
  border-top: 1px solid var(--border-subtle);
}

.disk-policy-row code {
  display: block;
  font-size: 0.8rem;
}

.capacity-cell {
  gap: 0.2rem;
  font-size: 0.78rem;
}

.capacity-total-readonly {
  color: var(--text-muted);
}

.disk-control-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
}

.disk-control-toggle.is-disabled {
  cursor: default;
}

.disk-control-toggle .metric-toggle-input:checked + .metric-toggle-box,
.disk-control-toggle .metric-toggle-box.is-checked-static {
  background: var(--accent);
  border-color: var(--accent);
}

.disk-control-toggle .metric-toggle-input:checked + .metric-toggle-box::after,
.disk-control-toggle .metric-toggle-box.is-checked-static::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 45%;
  width: 0.28rem;
  height: 0.52rem;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: translate(-50%, -50%) rotate(45deg);
}

.form-error {
  color: var(--danger);
  margin: 0;
}

@media (max-width: 720px) {
  .policy-mode-grid {
    grid-template-columns: 1fr;
  }
}
</style>
