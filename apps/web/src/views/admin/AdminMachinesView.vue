<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { Machine } from "@/types";

const store = useMachinesStore();
const loading = ref(true);
const search = ref("");

// Modal state
const showModal = ref(false);
const editing = ref<Machine | null>(null);
const form = reactive({
  name: "",
  description: "",
  macAddress: "",
  status: "offline" as string,
});
const saving = ref(false);
const error = ref("");

// Token state
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
  const q = search.value.toLowerCase();
  if (!q) return store.machines;
  return store.machines.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.status.includes(q) ||
      (m.description && m.description.toLowerCase().includes(q)),
  );
});

function openCreate() {
  editing.value = null;
  form.name = "";
  form.description = "";
  form.macAddress = "";
  form.status = "offline";
  error.value = "";
  showModal.value = true;
}

function openEdit(m: Machine) {
  editing.value = m;
  form.name = m.name;
  form.description = m.description || "";
  form.macAddress = m.macAddress;
  form.status = m.status;
  error.value = "";
  showModal.value = true;
}

async function handleSave() {
  error.value = "";
  if (!form.name || !form.macAddress) {
    error.value = "Nome e MAC são obrigatórios.";
    return;
  }

  saving.value = true;
  try {
    if (editing.value) {
      await store.updateMachine(editing.value.id, {
        name: form.name,
        description: form.description,
        macAddress: form.macAddress,
        status: form.status,
      });
    } else {
      const created = await store.createMachine({
        name: form.name,
        description: form.description,
        macAddress: form.macAddress,
      });
      // Show token for newly created machine
      if (created.token) {
        tokenValue.value = created.token;
        tokenMachine.value = created.name;
        tokenModal.value = true;
      }
    }
    showModal.value = false;
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 422) error.value = "Dados inválidos. Verifique os campos.";
    else error.value = "Erro ao salvar máquina.";
  } finally {
    saving.value = false;
  }
}

async function handleDelete(m: Machine) {
  if (!confirm(`Excluir "${m.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await store.deleteMachine(m.id);
  } catch {
    alert("Erro ao excluir máquina.");
  }
}

async function handleRegenerateToken(m: Machine) {
  if (
    !confirm(`Regenerar token de "${m.name}"? O token atual será invalidado.`)
  )
    return;
  try {
    const result = await store.regenerateToken(m.id);
    tokenValue.value = result.token;
    tokenMachine.value = m.name;
    tokenModal.value = true;
  } catch {
    alert("Erro ao regenerar token.");
  }
}

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

function copyToken() {
  navigator.clipboard.writeText(tokenValue.value).catch(() => {});
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Gerenciar Máquinas</h1>
      <div
        style="
          display: flex;
          gap: 0.75rem;
          align-items: center;
          flex-wrap: wrap;
        "
      >
        <input
          v-model="search"
          type="text"
          placeholder="Buscar..."
          style="max-width: 220px; padding: 0.5rem 0.85rem; font-size: 0.88rem"
        />
        <button class="btn btn-primary" @click="openCreate">
          + Nova Máquina
        </button>
      </div>
    </div>

    <div v-if="loading" class="empty-state">Carregando...</div>
    <div v-else-if="filtered.length === 0" class="empty-state">
      Nenhuma máquina encontrada.
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>MAC</th>
            <th>Status</th>
            <th>IP</th>
            <th>Último Report</th>
            <th style="width: 180px">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in filtered" :key="m.id">
            <td style="font-weight: 500">{{ m.name }}</td>
            <td
              class="text-secondary"
              style="font-size: 0.82rem; font-family: monospace"
            >
              {{ m.macAddress }}
            </td>
            <td>
              <span :class="['badge', statusBadge(m.status)]">{{
                statusLabel(m.status)
              }}</span>
            </td>
            <td class="text-secondary">{{ m.ipAddress || "—" }}</td>
            <td class="text-muted" style="font-size: 0.82rem">
              {{
                m.lastSeenAt
                  ? new Date(m.lastSeenAt).toLocaleString("pt-BR")
                  : "Nunca"
              }}
            </td>
            <td>
              <div style="display: flex; gap: 0.35rem; flex-wrap: wrap">
                <button
                  class="btn btn-ghost btn-sm text-accent"
                  @click="
                    $router.push({
                      name: 'admin-machine-detail',
                      params: { id: m.id },
                    })
                  "
                >
                  Ver
                </button>
                <button class="btn btn-ghost btn-sm" @click="openEdit(m)">
                  Editar
                </button>
                <button
                  class="btn btn-ghost btn-sm text-accent"
                  @click="handleRegenerateToken(m)"
                >
                  Token
                </button>
                <button class="btn btn-danger btn-sm" @click="handleDelete(m)">
                  Excluir
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create/Edit Modal -->
    <Teleport to="body">
      <div
        v-if="showModal"
        class="modal-overlay"
        @click.self="showModal = false"
      >
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">
              {{ editing ? "Editar Máquina" : "Nova Máquina" }}
            </h2>
            <button class="btn-close" @click="showModal = false">✕</button>
          </div>
          <form class="modal-body" @submit.prevent="handleSave">
            <div class="field">
              <label class="field-label">Nome</label>
              <input
                v-model="form.name"
                type="text"
                placeholder="Ex: Lab-PC-01"
              />
            </div>
            <div class="field">
              <label class="field-label">Descrição</label>
              <input
                v-model="form.description"
                type="text"
                placeholder="Descrição da máquina"
              />
            </div>
            <div class="field">
              <label class="field-label">MAC Address</label>
              <input
                v-model="form.macAddress"
                type="text"
                placeholder="AA:BB:CC:DD:EE:FF"
              />
            </div>
            <div v-if="editing" class="field">
              <label class="field-label">Status</label>
              <select v-model="form.status">
                <option value="available">Disponível</option>
                <option value="occupied">Ocupada</option>
                <option value="maintenance">Manutenção</option>
                <option value="offline">Offline</option>
              </select>
            </div>

            <p v-if="error" class="error-text">{{ error }}</p>

            <div class="modal-actions">
              <button
                type="button"
                class="btn btn-ghost"
                @click="showModal = false"
              >
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary" :disabled="saving">
                {{ saving ? "Salvando..." : "Salvar" }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Token Modal -->
    <Teleport to="body">
      <div
        v-if="tokenModal"
        class="modal-overlay"
        @click.self="tokenModal = false"
      >
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">Token — {{ tokenMachine }}</h2>
            <button class="btn-close" @click="tokenModal = false">✕</button>
          </div>
          <div class="modal-body">
            <p class="text-secondary" style="font-size: 0.88rem">
              Copie o token abaixo. Ele
              <strong>não será exibido novamente</strong>.
            </p>
            <div class="token-box">
              <code>{{ tokenValue }}</code>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" @click="copyToken">Copiar</button>
              <button class="btn btn-primary" @click="tokenModal = false">
                Fechar
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
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
  margin-top: 0.5rem;
}
.token-box {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.9rem 1rem;
  word-break: break-all;
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--accent);
  user-select: text;
}
</style>
