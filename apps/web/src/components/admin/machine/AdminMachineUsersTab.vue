<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useMachinesStore } from "@/stores/machines";
import { useUsersStore } from "@/stores/users";
import type { Machine, MachineProvisionedUser, MachineAccessType } from "@/types";

const props = defineProps<{ machine: Machine }>();

const store = useMachinesStore();
const usersStore = useUsersStore();
const users = ref<MachineProvisionedUser[]>([]);
const loading = ref(true);
const acting = ref<number | null>(null);
const error = ref("");
const showAdd = ref(false);
const addUserId = ref<number | "">("");
const addAccessType = ref<Exclude<MachineAccessType, "auto">>("shell");

const fixedAccessOptions: {
  value: Exclude<MachineAccessType, "auto">;
  label: string;
}[] = [
  { value: "shell", label: "Shell" },
  { value: "sftp", label: "SFTP" },
  { value: "revoked", label: "Sem acesso" },
];

const availableUsers = computed(() => {
  const linked = new Set(users.value.map((u) => u.userId));
  return usersStore.users.filter((u) => !linked.has(u.id));
});

function dropdownValue(row: MachineProvisionedUser): string {
  return row.accessType === "auto" ? "" : row.accessType;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    users.value = await store.fetchProvisionedUsers(props.machine.id);
  } catch {
    error.value = "Não foi possível carregar usuários da máquina.";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await usersStore.fetchUsers();
  await load();
});

async function onAccessChange(
  row: MachineProvisionedUser,
  accessType: Exclude<MachineAccessType, "auto">,
) {
  if (row.accessType === accessType) return;
  acting.value = row.userId;
  error.value = "";
  try {
    users.value = await store.updateProvisionedUser(
      props.machine.id,
      row.userId,
      accessType,
    );
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response
      ?.data?.message;
    error.value = msg || "Erro ao atualizar acesso.";
  } finally {
    acting.value = null;
  }
}

async function removeUser(row: MachineProvisionedUser) {
  if (
    !confirm(
      `Remover ${row.osUsername} desta máquina?\n\n` +
        "A conta será retirada no próximo heartbeat do agente.",
    )
  ) {
    return;
  }

  acting.value = row.userId;
  error.value = "";
  try {
    users.value = await store.removeProvisionedUser(props.machine.id, row.userId);
  } catch (err: unknown) {
    error.value =
      (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message || "Não foi possível remover o usuário.";
  } finally {
    acting.value = null;
  }
}

async function submitAdd() {
  if (!addUserId.value) {
    error.value = "Selecione um usuário.";
    return;
  }
  acting.value = -1;
  error.value = "";
  try {
    users.value = await store.addProvisionedUser(
      props.machine.id,
      Number(addUserId.value),
      addAccessType.value,
    );
    showAdd.value = false;
    addUserId.value = "";
    addAccessType.value = "shell";
  } catch (err: unknown) {
    const data = (err as { response?: { data?: { message?: string; code?: string } } })
      ?.response?.data;
    error.value = data?.message || "Não foi possível adicionar o usuário.";
  } finally {
    acting.value = null;
  }
}
</script>

<template>
  <div class="users-tab">
    <div class="tab-toolbar">
      <p class="tab-hint text-secondary">
        Vínculos <code>lab.*</code> nesta máquina. Acesso fixo (shell, SFTP ou sem acesso)
        ignora o ciclo da alocação no próximo heartbeat.
      </p>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="acting !== null"
        @click="showAdd = !showAdd"
      >
        {{ showAdd ? "Fechar" : "Adicionar usuário" }}
      </button>
    </div>

    <form v-if="showAdd" class="add-form card" @submit.prevent="submitAdd">
      <div class="add-row">
        <label class="field">
          <span class="field-label">Usuário</span>
          <select v-model="addUserId" required class="access-select">
            <option value="" disabled>Selecione…</option>
            <option v-for="u in availableUsers" :key="u.id" :value="u.id">
              {{ u.fullName }} ({{ u.systemUsername || u.email }})
            </option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Acesso</span>
          <select v-model="addAccessType" class="access-select">
            <option
              v-for="opt in fixedAccessOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </label>
        <button
          type="submit"
          class="btn btn-primary btn-sm"
          :disabled="acting !== null || availableUsers.length === 0"
        >
          {{ acting === -1 ? "Adicionando…" : "Confirmar" }}
        </button>
      </div>
      <p v-if="availableUsers.length === 0" class="text-muted add-empty">
        Todos os usuários do sistema já estão vinculados a esta máquina.
      </p>
    </form>

    <div v-if="loading" class="empty-state">Carregando…</div>
    <div v-else-if="users.length === 0" class="empty-state">
      Nenhum usuário vinculado a esta máquina.
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Usuário SO</th>
            <th>Nome</th>
            <th>Acesso</th>
            <th>Última atividade</th>
            <th class="col-actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in users" :key="row.id">
            <td><code>{{ row.osUsername }}</code></td>
            <td>{{ row.fullName }}</td>
            <td>
              <select
                class="access-select"
                :value="dropdownValue(row)"
                :disabled="acting === row.userId"
                @change="
                  onAccessChange(
                    row,
                    ($event.target as HTMLSelectElement).value as Exclude<
                      MachineAccessType,
                      'auto'
                    >,
                  )
                "
              >
                <option v-if="row.accessType === 'auto'" value="" disabled>
                  Auto (alocação)
                </option>
                <option
                  v-for="opt in fixedAccessOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </td>
            <td class="text-muted" style="font-size: 0.82rem">
              {{
                row.lastActiveAt
                  ? new Date(row.lastActiveAt).toLocaleString("pt-BR")
                  : "—"
              }}
            </td>
            <td class="col-actions">
              <button
                type="button"
                class="btn btn-danger btn-sm"
                :disabled="acting === row.userId"
                @click="removeUser(row)"
              >
                Excluir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.tab-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.tab-hint {
  font-size: 0.85rem;
  margin: 0;
  line-height: 1.45;
  flex: 1;
}

.tab-hint code {
  font-size: 0.78rem;
}

.add-form {
  padding: 1rem;
  margin-bottom: 1rem;
}

.add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
}

.add-row .field {
  flex: 1;
  min-width: 10rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.add-empty {
  font-size: 0.82rem;
  margin: 0.5rem 0 0;
}

.access-select {
  min-width: 9rem;
  font-size: 0.82rem;
}

.auto-hint {
  display: block;
  font-size: 0.72rem;
  margin-top: 0.15rem;
}

.col-actions {
  width: 100px;
  white-space: nowrap;
}

.form-error {
  color: var(--danger);
  font-size: 0.88rem;
  margin-top: 0.5rem;
}
</style>
