<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useSystemMaintenanceStore } from "@/stores/systemMaintenance";
import type { Machine, SshConnectionAttempt } from "@/types";

const props = defineProps<{ machine: Machine }>();

const maintenanceStore = useSystemMaintenanceStore();
const attempts = ref<SshConnectionAttempt[]>([]);
const loading = ref(true);
const meta = ref({ total: 0, currentPage: 1, lastPage: 1 });

async function load(page = 1) {
  loading.value = true;
  try {
    const data = await maintenanceStore.fetchSshAttempts({
      machineId: props.machine.id,
      page,
      limit: 50,
    });
    attempts.value = data.data;
    meta.value = {
      total: data.meta.total,
      currentPage: data.meta.currentPage,
      lastPage: data.meta.lastPage,
    };
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());

function statusBadge(s: string) {
  const map: Record<string, string> = {
    success: "badge-success",
    failed: "badge-danger",
    invalid_user: "badge-warning",
  };
  return map[s] || "badge-muted";
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    success: "Sucesso",
    failed: "Falha",
    invalid_user: "Usuário inválido",
  };
  return map[s] || s;
}

async function removeAttempt(id: number) {
  if (!confirm("Remover este registro de tentativa SSH?")) return;
  await maintenanceStore.deleteSshAttempt(id);
  await load(meta.value.currentPage);
}
</script>

<template>
  <div class="ssh-tab">
    <p class="tab-hint text-secondary">
      Tentativas reportadas pelo agente desta máquina (auditoria SSH).
    </p>

    <div v-if="loading" class="empty-state">Carregando…</div>
    <div v-else-if="attempts.length === 0" class="empty-state">
      Nenhuma tentativa registrada.
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>IP origem</th>
            <th>Usuário alvo</th>
            <th>Status</th>
            <th>Método</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in attempts" :key="a.id">
            <td class="text-muted" style="font-size: 0.82rem">
              {{ new Date(a.createdAt).toLocaleString("pt-BR") }}
            </td>
            <td><code>{{ a.sourceIp }}</code></td>
            <td><code>{{ a.targetUsername }}</code></td>
            <td>
              <span :class="['badge', statusBadge(a.status)]">
                {{ statusLabel(a.status) }}
              </span>
            </td>
            <td class="text-muted">{{ a.authMethod || "—" }}</td>
            <td>
              <button
                type="button"
                class="btn btn-ghost btn-sm text-danger"
                @click="removeAttempt(a.id)"
              >
                Excluir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="meta.lastPage > 1" class="pager">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="meta.currentPage <= 1 || loading"
        @click="load(meta.currentPage - 1)"
      >
        Anterior
      </button>
      <span class="text-muted" style="font-size: 0.82rem">
        {{ meta.currentPage }} / {{ meta.lastPage }} ({{ meta.total }} registros)
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="meta.currentPage >= meta.lastPage || loading"
        @click="load(meta.currentPage + 1)"
      >
        Próxima
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-hint {
  font-size: 0.85rem;
  margin-bottom: 1rem;
}
.pager {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}
.text-danger {
  color: var(--danger);
}
</style>
