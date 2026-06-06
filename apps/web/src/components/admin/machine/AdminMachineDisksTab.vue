<script setup lang="ts">
import { ref, reactive, watch } from "vue";
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

function loadFromMachine(m: Machine) {
  onlyMainDisk.value = Boolean(m.onlyMainDisk);
  disks.value = (m.disks ?? []).map((d, index) => ({
    ...d,
    id: d.id ?? index,
    role: d.role ?? "user",
    mainDisk: Boolean(d.mainDisk),
  }));
}

loadFromMachine(props.machine);

watch(
  () => props.machine,
  (m) => loadFromMachine(m),
  { deep: true },
);

function setMainDisk(mountpoint: string) {
  disks.value = applyMainDiskSelection(disks.value, mountpoint);
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
      Partições sincronizadas pelo agente. Defina qual volume de user-space é o
      <strong>disco principal</strong> e se alocações ficam restritas a ele.
    </p>

    <label class="policy-row">
      <input v-model="onlyMainDisk" type="checkbox" />
      <span>
        <strong>Somente disco principal</strong>
        <span class="text-muted policy-sub">
          — usuários não escolhem outro volume na reserva
        </span>
      </span>
    </label>

    <div v-if="userDisks().length === 0" class="empty-state">
      Nenhuma partição de user-space reportada. Aguarde sync-specs do agente.
    </div>

    <div v-else class="disk-policy-table">
      <div class="disk-policy-header">
        <span>Partição</span>
        <span>Tipo</span>
        <span>Capacidade</span>
        <span>Principal</span>
      </div>
      <div v-for="(d, i) in disks" :key="`${d.device}-${d.mountpoint}-${i}`" class="disk-policy-row">
        <span>
          <code>{{ d.mountpoint }}</code>
          <small class="text-muted">{{ d.device }}</small>
        </span>
        <span>
          <span
            class="badge"
            :class="d.role === 'system' ? 'badge-muted' : 'badge-success'"
          >
            {{ partitionRoleLabel(d.role) }}
          </span>
        </span>
        <span class="text-secondary">
          {{ d.freeGb != null ? `${d.freeGb} / ${d.totalGb ?? "—"} GB` : "—" }}
        </span>
        <span>
          <label v-if="(d.role ?? 'user') === 'user'" class="main-radio">
            <input
              type="radio"
              name="mainDisk"
              :checked="d.mainDisk"
              @change="setMainDisk(d.mountpoint)"
            />
            Principal
          </label>
          <span v-else class="text-muted">—</span>
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
  max-width: 820px;
}

.tab-hint {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
}

.policy-row {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.policy-sub {
  display: block;
  font-size: 0.78rem;
  margin-top: 0.15rem;
}

.disk-policy-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
}

.disk-policy-header,
.disk-policy-row {
  display: grid;
  grid-template-columns: 1.4fr 0.7fr 1fr 0.9fr;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  align-items: center;
  font-size: 0.82rem;
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

.main-radio {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
}

.form-error {
  color: var(--danger);
  margin: 0;
}
</style>
