<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useMachinesStore } from "@/stores/machines";
import type { Machine } from "@/types";

const router = useRouter();
const store = useMachinesStore();
const loading = ref(true);
const search = ref("");

const showCreateModal = ref(false);
const createForm = reactive({
  name: "",
  description: "",
  ipAddress: "",
  sshPort: "",
});
const creating = ref(false);
const createError = ref("");
const tokenModal = ref(false);
const tokenValue = ref("");
const tokenMachine = ref("");

onMounted(async () => {
  try {
    await store.fetchMachines();
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim();
  if (!q) return store.machines;
  return store.machines.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.status.includes(q) ||
      (m.description && m.description.toLowerCase().includes(q)) ||
      (m.group?.title && m.group.title.toLowerCase().includes(q)),
  );
});

function parseSshPortInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function goToView(m: Machine) {
  router.push({
    name: "machine-detail",
    params: { id: m.id },
    query: { from: "admin" },
  });
}

function goToEdit(m: Machine, event?: Event) {
  event?.stopPropagation();
  router.push({
    name: "admin-machine-edit",
    params: { id: m.id },
    query: { from: "admin-machines" },
  });
}

async function handleDelete(m: Machine, event: Event) {
  event.stopPropagation();
  if (!confirm(`Excluir "${m.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await store.deleteMachine(m.id);
  } catch (err) {
    alert(
      err instanceof Error ? err.message : "Erro ao excluir máquina.",
    );
  }
}

function openCreate() {
  createForm.name = "";
  createForm.description = "";
  createForm.ipAddress = "";
  createForm.sshPort = "";
  createError.value = "";
  showCreateModal.value = true;
}

async function handleCreate() {
  createError.value = "";
  if (!createForm.name.trim()) {
    createError.value = "Nome é obrigatório.";
    return;
  }
  creating.value = true;
  try {
    const created = await store.createMachine({
      name: createForm.name.trim(),
      description: createForm.description.trim(),
      ipAddress: createForm.ipAddress.trim() || undefined,
      sshPort: parseSshPortInput(createForm.sshPort),
    });
    showCreateModal.value = false;
    if (created.token) {
      tokenValue.value = created.token;
      tokenMachine.value = created.name;
      tokenModal.value = true;
    }
  } catch {
    createError.value = "Erro ao criar máquina.";
  } finally {
    creating.value = false;
  }
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    available: "badge-success",
    occupied: "badge-warning",
    maintenance: "badge-info",
    offline: "badge-danger",
    disabled: "badge-danger",
  };
  return map[s] || "badge-muted";
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    available: "Disponível",
    occupied: "Ocupada",
    maintenance: "Manutenção",
    offline: "Offline",
    disabled: "Desativada",
  };
  return map[s] || s;
}

function copyToken() {
  navigator.clipboard.writeText(tokenValue.value).catch(() => {});
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Gerenciar Máquinas</h1>
      <div class="page-toolbar">
        <input
          v-model="search"
          type="text"
          class="search-input"
          placeholder="Buscar..."
        />
        <button class="btn btn-primary btn-new-machine" @click="openCreate">
          + Nova Máquina
        </button>
      </div>
    </div>

    <div v-if="loading" class="empty-state">Carregando...</div>
    <div v-else-if="filtered.length === 0" class="empty-state">
      Nenhuma máquina encontrada.
    </div>

    <div v-else class="table-wrap machines-table">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Status</th>
            <th>Grupo</th>
            <th>IP</th>
            <th class="col-actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in filtered" :key="m.id">
            <td>
              <span class="machine-name">{{ m.name }}</span>
            </td>
            <td>
              <span :class="['badge', statusBadge(m.status)]">
                {{ statusLabel(m.status) }}
              </span>
            </td>
            <td class="text-secondary">
              {{ m.group?.title ?? "Outros" }}
            </td>
            <td class="text-secondary">{{ m.ipAddress || "—" }}</td>
            <td class="col-actions">
              <div class="actions-cell">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="goToView(m)"
                >
                  Ver
                </button>
                <button type="button" class="btn btn-ghost btn-sm" @click="goToEdit(m)">
                  Editar
                </button>
                <button
                  type="button"
                  class="btn btn-danger btn-sm"
                  @click="handleDelete(m, $event)"
                >
                  Excluir
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div
        v-if="showCreateModal"
        class="modal-overlay"
        @click.self="showCreateModal = false"
      >
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">Nova Máquina</h2>
            <button class="btn-close" @click="showCreateModal = false">✕</button>
          </div>
          <form class="modal-body" @submit.prevent="handleCreate">
            <div class="field">
              <label class="field-label">Nome</label>
              <input v-model="createForm.name" type="text" placeholder="Ex: Lab-PC-01" />
            </div>
            <div class="field">
              <label class="field-label">Descrição</label>
              <input v-model="createForm.description" type="text" />
            </div>
            <div class="field">
              <label class="field-label">IP local</label>
              <input v-model="createForm.ipAddress" type="text" placeholder="Opcional" />
            </div>
            <div class="field">
              <label class="field-label">Porta SSH</label>
              <input v-model="createForm.sshPort" type="text" placeholder="22" />
            </div>
            <p v-if="createError" class="form-error">{{ createError }}</p>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" @click="showCreateModal = false">
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary" :disabled="creating">
                {{ creating ? "Criando…" : "Criar" }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div v-if="tokenModal" class="modal-overlay" @click.self="tokenModal = false">
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">Token — {{ tokenMachine }}</h2>
            <button class="btn-close" @click="tokenModal = false">✕</button>
          </div>
          <div class="modal-body">
            <p class="text-secondary" style="font-size: 0.88rem">
              Copie o token abaixo. Ele <strong>não será exibido novamente</strong>.
            </p>
            <div class="token-box"><code>{{ tokenValue }}</code></div>
            <div class="modal-actions">
              <button class="btn btn-ghost" @click="copyToken">Copiar</button>
              <button class="btn btn-primary" @click="tokenModal = false">Fechar</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: nowrap;
}
.search-input {
  width: 220px;
  max-width: 100%;
  padding: 0.5rem 0.85rem;
  font-size: 0.88rem;
  height: 38px;
}
.btn-new-machine {
  height: 38px;
  white-space: nowrap;
}
.machines-table th,
.machines-table td {
  text-align: center;
}

.machines-table .col-actions {
  width: 220px;
  min-width: 220px;
}

.machines-table .machine-name {
  font-weight: 500;
}

.machines-table .actions-cell {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: nowrap;
  white-space: nowrap;
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
  width: 100%;
  max-width: 460px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
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
.token-box {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.9rem;
  word-break: break-all;
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--accent);
}
.form-error {
  color: var(--danger);
  font-size: 0.88rem;
}
</style>
