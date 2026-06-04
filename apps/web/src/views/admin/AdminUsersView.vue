<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { useUsersStore } from "@/stores/users";
import { useAuthStore } from "@/stores/auth";
import type { User } from "@/types";

const store = useUsersStore();
const auth = useAuthStore();
const loading = ref(true);
const search = ref("");

// Modal state
const showModal = ref(false);
const editing = ref<User | null>(null);
const form = reactive({ fullName: "", email: "", password: "", role: "user" });
const saving = ref(false);
const error = ref("");

onMounted(async () => {
  try {
    await store.fetchUsers();
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return store.users;
  return store.users.filter(
    (u) =>
      u.fullName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.includes(q),
  );
});

const isEditingOther = computed(
  () => !!editing.value && auth.user?.id !== editing.value.id,
);

function openCreate() {
  editing.value = null;
  form.fullName = "";
  form.email = "";
  form.password = "";
  form.role = "user";
  error.value = "";
  showModal.value = true;
}

function openEdit(u: User) {
  editing.value = u;
  form.fullName = u.fullName;
  form.email = u.email;
  form.password = "";
  form.role = u.role;
  error.value = "";
  showModal.value = true;
}

async function handleSave() {
  error.value = "";

  if (!editing.value) {
    if (!form.fullName || !form.email) {
      error.value = "Nome e email são obrigatórios.";
      return;
    }
    if (!form.password) {
      error.value = "Senha é obrigatória para novos usuários.";
      return;
    }

    saving.value = true;
    try {
      await store.createUser({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        role: form.role,
      });
      showModal.value = false;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 422) error.value = "Dados inválidos. Verifique os campos.";
      else if (status === 409) error.value = "Este email já está em uso.";
      else error.value = "Erro ao salvar usuário.";
    } finally {
      saving.value = false;
    }
    return;
  }

  const payload: Record<string, unknown> = {};
  if (form.password) payload.password = form.password;
  if (isEditingOther.value && form.role !== editing.value.role) {
    payload.role = form.role;
  }

  if (Object.keys(payload).length === 0) {
    error.value = isEditingOther.value
      ? "Informe uma nova senha ou altere o cargo."
      : "Informe uma nova senha.";
    return;
  }

  saving.value = true;
  try {
    await store.updateUser(editing.value.id, payload);
    if (auth.user?.id === editing.value.id) {
      await auth.fetchMe();
    }
    showModal.value = false;
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 422) error.value = "Dados inválidos. Verifique os campos.";
    else if (status === 409) error.value = "Este email já está em uso.";
    else error.value = "Erro ao salvar usuário.";
  } finally {
    saving.value = false;
  }
}

async function handleDelete(u: User) {
  if (!confirm(`Excluir ${u.fullName}? Esta ação não pode ser desfeita.`))
    return;
  try {
    await store.deleteUser(u.id);
  } catch {
    alert("Erro ao excluir usuário.");
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Usuários</h1>
      <div class="page-toolbar">
        <input
          v-model="search"
          type="text"
          class="search-input"
          placeholder="Buscar..."
        />
        <button class="btn btn-primary btn-new-user" @click="openCreate">
          + Novo Usuário
        </button>
      </div>
    </div>

    <div v-if="loading" class="empty-state">Carregando...</div>
    <div v-else-if="filtered.length === 0" class="empty-state">
      Nenhum usuário encontrado.
    </div>

    <div v-else class="table-wrap users-table">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Email</th>
            <th>Tipo</th>
            <th>Cadastro</th>
            <th class="col-actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>
              <span class="user-name">{{ u.fullName }}</span>
            </td>
            <td>{{ u.email }}</td>
            <td>
              <span
                :class="[
                  'badge',
                  u.role === 'admin' ? 'badge-accent' : 'badge-info',
                ]"
              >
                {{ u.role === "admin" ? "Admin" : "Usuário" }}
              </span>
            </td>
            <td class="text-secondary">{{ fmtDate(u.createdAt) }}</td>
            <td class="col-actions">
              <div class="actions-cell">
                <button class="btn btn-ghost btn-sm" @click="openEdit(u)">
                  Editar
                </button>
                <button class="btn btn-danger btn-sm" @click="handleDelete(u)">
                  Excluir
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <div
        v-if="showModal"
        class="modal-overlay"
        @click.self="showModal = false"
      >
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">
              {{ editing ? "Editar Usuário" : "Novo Usuário" }}
            </h2>
            <button class="btn-close" @click="showModal = false">✕</button>
          </div>
          <form class="modal-body" @submit.prevent="handleSave">
            <template v-if="!editing">
              <div class="field">
                <label class="field-label">Nome completo</label>
                <input v-model="form.fullName" type="text" />
              </div>
              <div class="field">
                <label class="field-label">Email</label>
                <input v-model="form.email" type="email" />
              </div>
              <div class="field">
                <label class="field-label">Senha</label>
                <input
                  v-model="form.password"
                  type="password"
                  autocomplete="new-password"
                />
              </div>
              <div class="field">
                <label class="field-label">Cargo</label>
                <select v-model="form.role">
                  <option value="user">Usuário</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </template>

            <template v-else>
              <div class="field">
                <label class="field-label">Nome completo</label>
                <input :value="form.fullName" type="text" disabled />
              </div>
              <div class="field">
                <label class="field-label">Email</label>
                <input :value="form.email" type="email" disabled />
              </div>
              <div class="field">
                <label class="field-label">Senha (em branco = manter)</label>
                <input
                  v-model="form.password"
                  type="password"
                  autocomplete="new-password"
                />
              </div>
              <div v-if="isEditingOther" class="field">
                <label class="field-label">Cargo</label>
                <select v-model="form.role">
                  <option value="user">Usuário</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </template>

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
  box-sizing: border-box;
}

.btn-new-user {
  height: 38px;
  padding: 0 1rem;
  font-size: 0.88rem;
  white-space: nowrap;
}

.users-table th,
.users-table td {
  text-align: center;
}

.users-table .col-actions {
  width: 190px;
  min-width: 190px;
}

.users-table .user-name {
  font-weight: 500;
}

.users-table .actions-cell {
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
  box-shadow: var(--shadow-elevated);
  width: 100%;
  max-width: 440px;
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
</style>
