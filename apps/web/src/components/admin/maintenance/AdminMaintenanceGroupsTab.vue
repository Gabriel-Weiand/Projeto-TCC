<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import {
  useMachineGroupsStore,
  DEFAULT_GROUP_TITLE,
} from "@/stores/machineGroups";
import { useMachinesStore } from "@/stores/machines";
import type { Machine, MachineGroup } from "@/types";

const groupsStore = useMachineGroupsStore();
const machinesStore = useMachinesStore();

const loading = ref(true);
const showModal = ref(false);
const editing = ref<MachineGroup | null>(null);
const saving = ref(false);
const error = ref("");

const form = reactive({
  title: "",
  description: "",
  machineIds: [] as number[],
});

const machineSearch = ref("");
const GRID_SLOTS = 12;

const sortedMachines = computed(() =>
  [...machinesStore.machines].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
);

const filteredMachines = computed(() => {
  const q = machineSearch.value.trim().toLowerCase();
  const list = q
    ? sortedMachines.value.filter((m) => m.name.toLowerCase().includes(q))
    : sortedMachines.value;
  return list.slice(0, GRID_SLOTS);
});

const gridSlots = computed((): (Machine | null)[] => {
  const slots: (Machine | null)[] = Array.from({ length: GRID_SLOTS }, () => null);
  filteredMachines.value.forEach((m, i) => {
    slots[i] = m;
  });
  return slots;
});

const hiddenMachineCount = computed(() => {
  const q = machineSearch.value.trim().toLowerCase();
  const list = q
    ? sortedMachines.value.filter((m) => m.name.toLowerCase().includes(q))
    : sortedMachines.value;
  return Math.max(0, list.length - GRID_SLOTS);
});

onMounted(async () => {
  try {
    await Promise.all([groupsStore.fetchGroups(), machinesStore.fetchMachines()]);
  } finally {
    loading.value = false;
  }
});

const sortedGroups = computed(() => groupsStore.groups);

function openCreate() {
  editing.value = null;
  form.title = "";
  form.description = "";
  form.machineIds = [];
  machineSearch.value = "";
  error.value = "";
  showModal.value = true;
}

function openEdit(group: MachineGroup) {
  editing.value = group;
  form.title = group.title;
  form.description = group.description || "";
  form.machineIds = (group.machines ?? []).map((m) => m.id);
  machineSearch.value = "";
  error.value = "";
  showModal.value = true;
}

function toggleMachine(id: number) {
  const idx = form.machineIds.indexOf(id);
  if (idx === -1) form.machineIds.push(id);
  else form.machineIds.splice(idx, 1);
}

async function handleSave() {
  error.value = "";
  if (!form.title.trim()) {
    error.value = "Título é obrigatório.";
    return;
  }
  saving.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      machineIds: form.machineIds,
    };
    if (editing.value) {
      await groupsStore.updateGroup(editing.value.id, payload);
    } else {
      await groupsStore.createGroup(payload);
    }
    await machinesStore.fetchMachines();
    showModal.value = false;
  } catch (err: any) {
    error.value =
      err.response?.data?.message || "Não foi possível salvar o grupo.";
  } finally {
    saving.value = false;
  }
}

async function handleDelete(group: MachineGroup) {
  if (group.title === DEFAULT_GROUP_TITLE) return;
  if (!confirm(`Remover grupo "${group.title}"? As máquinas ficarão em Outros.`)) return;
  try {
    await groupsStore.deleteGroup(group.id);
    await machinesStore.fetchMachines();
  } catch {
    alert("Erro ao remover grupo.");
  }
}
</script>

<template>
  <div class="maintenance-tab groups-tab">
    <div class="tab-header">
      <p class="tab-lead text-secondary">
        Organize o laboratório em grupos. Máquinas sem grupo aparecem como Outros.
      </p>
      <button type="button" class="btn btn-primary group-action-btn" @click="openCreate">
        + Novo grupo
      </button>
    </div>

    <div v-if="loading" class="empty-state">Carregando…</div>
    <div v-else-if="sortedGroups.length === 0" class="empty-state">
      Nenhum grupo cadastrado.
    </div>

    <div v-else class="groups-grid">
      <div v-for="group in sortedGroups" :key="group.id" class="card group-card">
        <span
          class="machine-count"
          :title="`${group.machines?.length ?? 0} máquinas`"
          aria-hidden="true"
        >
          {{ group.machines?.length ?? 0 }}
        </span>
        <h3 class="group-title">{{ group.title }}</h3>
        <p class="group-desc text-secondary">
          {{ group.description || "Sem descrição" }}
        </p>
        <div class="group-actions">
          <button
            type="button"
            class="btn btn-ghost group-action-btn"
            @click="openEdit(group)"
          >
            Editar
          </button>
          <button
            v-if="group.title !== DEFAULT_GROUP_TITLE"
            type="button"
            class="btn btn-danger group-action-btn"
            @click="handleDelete(group)"
          >
            Excluir
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
        <div class="modal-glass fade-in modal-wide">
          <div class="modal-header">
            <h2 class="modal-title">{{ editing ? "Editar grupo" : "Novo grupo" }}</h2>
            <button class="btn-close" @click="showModal = false">✕</button>
          </div>
          <form class="modal-body" @submit.prevent="handleSave">
            <div class="field">
              <label class="field-label">Título</label>
              <input v-model="form.title" type="text" placeholder="Ex: CUDA — Pesquisa" />
            </div>
            <div class="field">
              <label class="field-label">Descrição</label>
              <textarea v-model="form.description" class="field-textarea" rows="2" />
            </div>
            <div class="field machine-pick-field">
              <div class="machine-pick-header">
                <label class="field-label machine-pick-title">Máquinas do grupo</label>
                <input
                  v-model="machineSearch"
                  type="search"
                  class="machine-pick-search"
                  placeholder="Buscar máquina…"
                  autocomplete="off"
                />
              </div>
              <div class="metric-toggle-grid machine-pick-grid">
                <template v-for="(m, idx) in gridSlots" :key="m ? m.id : `empty-${idx}`">
                  <div
                    v-if="!m"
                    class="metric-toggle machine-pick-empty"
                    aria-hidden="true"
                  />
                  <label
                    v-else
                    class="metric-toggle"
                    :class="{ 'is-checked': form.machineIds.includes(m.id) }"
                  >
                    <input
                      type="checkbox"
                      class="metric-toggle-input"
                      :checked="form.machineIds.includes(m.id)"
                      @change="toggleMachine(m.id)"
                    />
                    <span class="metric-toggle-box" aria-hidden="true" />
                    <span class="metric-toggle-label">{{ m.name }}</span>
                  </label>
                </template>
              </div>
              <p v-if="hiddenMachineCount > 0" class="machine-pick-hint text-muted">
                +{{ hiddenMachineCount }} máquina(s) oculta(s) — refine a busca para
                encontrá-las.
              </p>
            </div>
            <p v-if="error" class="form-error">{{ error }}</p>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" @click="showModal = false">
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary" :disabled="saving">
                {{ saving ? "Salvando…" : "Salvar" }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.tab-lead {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  text-align: left;
  flex: 1;
  min-width: 0;
}

.groups-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.85rem;
}

.group-card {
  position: relative;
  padding: 1rem 1.1rem;
  min-height: 148px;
  display: flex;
  flex-direction: column;
}

.group-title {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0 0 0.45rem;
  padding-right: 2rem;
}

.machine-count {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 50%;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid rgba(124, 108, 240, 0.35);
  box-shadow: 0 0 0 1px rgba(124, 108, 240, 0.08);
}

.group-desc {
  font-size: 0.82rem;
  line-height: 1.45;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.group-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.75rem;
  width: 100%;
}

.group-action-btn {
  flex-shrink: 0;
  font-size: 0.78rem;
  padding: 0.3rem 0.65rem;
  border-radius: 7px;
}

.machine-pick-field {
  gap: 0.65rem;
}

.machine-pick-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.machine-pick-title {
  margin: 0;
  flex-shrink: 0;
}

.machine-pick-search {
  width: min(220px, 100%);
  padding: 0.45rem 0.75rem;
  font-size: 0.82rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
}

.machine-pick-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(2.75rem, auto));
  min-height: calc(3 * 2.75rem + 2 * 0.5rem);
  padding: 0.65rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}

.machine-pick-empty {
  pointer-events: none;
  opacity: 0.22;
  border-style: dashed;
  cursor: default;
}

.machine-pick-hint {
  margin: 0;
  font-size: 0.78rem;
}

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
  max-width: 460px;
}

.modal-wide {
  max-width: 720px;
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
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.form-error {
  color: var(--danger);
  font-size: 0.88rem;
}
</style>
