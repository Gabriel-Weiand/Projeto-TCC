<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMachinesStore } from "@/stores/machines";
import { useMachineGroupsStore } from "@/stores/machineGroups";
import AdminTabBar from "@/components/admin/AdminTabBar.vue";
import MachineTelemetryPanel from "@/components/MachineTelemetryPanel.vue";
import AdminMachineUsersTab from "@/components/admin/machine/AdminMachineUsersTab.vue";
import AdminMachineSshTab from "@/components/admin/machine/AdminMachineSshTab.vue";
import type { Machine, MachineOperationalMode } from "@/types";

const route = useRoute();
const router = useRouter();
const machinesStore = useMachinesStore();
const groupsStore = useMachineGroupsStore();

const machineId = computed(() => Number(route.params.id));
const machine = ref<Machine | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref("");

const activeTab = ref("infos");
const editTabs = [
  { id: "infos", label: "Informações" },
  { id: "usuarios", label: "Usuários" },
  { id: "ssh", label: "SSH" },
];

const form = reactive({
  name: "",
  description: "",
  ipAddress: "",
  sshPort: "",
  operationalMode: "available" as MachineOperationalMode,
  machineGroupId: "" as string,
});

const tokenModal = ref(false);
const tokenValue = ref("");

function parseSshPortInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function resolveOperationalMode(m: Machine): MachineOperationalMode {
  if (m.operationalMode) return m.operationalMode;
  if (m.status === "maintenance") return "maintenance";
  if (m.status === "disabled") return "offline";
  return "available";
}

function loadForm(m: Machine) {
  form.name = m.name;
  form.description = m.description || "";
  form.ipAddress = m.ipAddress || "";
  form.sshPort = m.sshPort != null ? String(m.sshPort) : "";
  form.operationalMode = resolveOperationalMode(m);
  form.machineGroupId =
    m.machineGroupId != null ? String(m.machineGroupId) : "";
}

onMounted(async () => {
  try {
    const [m] = await Promise.all([
      machinesStore.fetchMachine(machineId.value),
      groupsStore.fetchGroups(),
    ]);
    machine.value = m;
    loadForm(m);
  } catch {
    router.push({ name: "admin-machines" });
  } finally {
    loading.value = false;
  }
});

watch(
  () => route.query.tab,
  (tab) => {
    if (typeof tab === "string" && editTabs.some((t) => t.id === tab)) {
      activeTab.value = tab;
    }
  },
  { immediate: true },
);

watch(activeTab, (tab) => {
  if (route.query.tab !== tab) {
    router.replace({ query: { ...route.query, tab } });
  }
});

async function handleSave() {
  if (!machine.value) return;
  error.value = "";
  if (!form.name.trim()) {
    error.value = "Nome é obrigatório.";
    return;
  }
  saving.value = true;
  try {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim(),
      ipAddress: form.ipAddress.trim() || null,
      sshPort: parseSshPortInput(form.sshPort),
      status: form.operationalMode,
      machineGroupId: form.machineGroupId
        ? Number.parseInt(form.machineGroupId, 10)
        : null,
    };
    const updated = await machinesStore.updateMachine(machine.value.id, payload);
    machine.value = updated;
    loadForm(updated);
  } catch {
    error.value = "Erro ao salvar máquina.";
  } finally {
    saving.value = false;
  }
}

async function handleRegenerateToken() {
  if (!machine.value) return;
  if (!confirm("Regenerar token? O token atual será invalidado.")) return;
  try {
    const result = await machinesStore.regenerateToken(machine.value.id);
    tokenValue.value = result.token;
    tokenModal.value = true;
  } catch {
    alert("Erro ao regenerar token.");
  }
}

function onTelemetrySaved(m: Machine) {
  machine.value = m;
}

function copyToken() {
  navigator.clipboard.writeText(tokenValue.value).catch(() => {});
}
</script>

<template>
  <div class="fade-in">
    <div class="top-nav">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        @click="
          router.push({
            name: 'machine-detail',
            params: { id: machineId },
            query: { from: 'admin' },
          })
        "
      >
        ← Ver máquina
      </button>
    </div>

    <div v-if="loading" class="empty-state">Carregando…</div>

    <template v-else-if="machine">
      <h1 class="page-title">Editar — {{ machine.name }}</h1>

      <AdminTabBar v-model="activeTab" :tabs="editTabs" />

      <div v-if="activeTab === 'infos'" class="edit-panel">
        <form class="infos-form" @submit.prevent="handleSave">
          <div class="field">
            <label class="field-label">Nome</label>
            <input v-model="form.name" type="text" />
          </div>
          <div class="field">
            <label class="field-label">Descrição</label>
            <textarea v-model="form.description" class="field-textarea" rows="2" />
          </div>
          <div class="field">
            <label class="field-label">IP local</label>
            <input
              v-model="form.ipAddress"
              type="text"
              placeholder="Capturado pelo agente / rede local"
            />
            <p class="field-hint text-muted">
              Endereço na rede local reportado pelo parque (não é IP público).
            </p>
          </div>
          <div class="field">
            <label class="field-label">Porta SSH <span class="text-muted">(vazio = 22)</span></label>
            <input v-model="form.sshPort" type="text" inputmode="numeric" />
          </div>
          <div class="field">
            <label class="field-label">Grupo</label>
            <select v-model="form.machineGroupId">
              <option value="">Outros (sem grupo)</option>
              <option
                v-for="g in groupsStore.groups"
                :key="g.id"
                :value="String(g.id)"
              >
                {{ g.title }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">Modo operacional</label>
            <select v-model="form.operationalMode">
              <option value="available">Disponível</option>
              <option value="offline">Desativada</option>
              <option value="maintenance">Manutenção</option>
            </select>
          </div>

          <p v-if="error" class="form-error">{{ error }}</p>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? "Salvando…" : "Salvar informações" }}
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              @click="handleRegenerateToken"
            >
              Regenerar token do agente
            </button>
          </div>
        </form>

        <div class="telemetry-block">
          <h2 class="block-title">Telemetria desta máquina</h2>
          <MachineTelemetryPanel :machine="machine" @saved="onTelemetrySaved" />
        </div>
      </div>

      <AdminMachineUsersTab v-else-if="activeTab === 'usuarios'" :machine="machine" />
      <AdminMachineSshTab v-else-if="activeTab === 'ssh'" :machine="machine" />
    </template>

    <Teleport to="body">
      <div v-if="tokenModal" class="modal-overlay" @click.self="tokenModal = false">
        <div class="modal-glass fade-in">
          <div class="modal-header">
            <h2 class="modal-title">Novo token do agente</h2>
            <button class="btn-close" @click="tokenModal = false">✕</button>
          </div>
          <div class="modal-body">
            <p class="text-secondary" style="font-size: 0.88rem">
              Copie agora — não será exibido novamente.
            </p>
            <div class="token-box"><code>{{ tokenValue }}</code></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" @click="copyToken">Copiar</button>
              <button type="button" class="btn btn-primary" @click="tokenModal = false">
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
.top-nav {
  margin-bottom: 1rem;
}
.edit-panel {
  max-width: 720px;
}
.infos-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 2rem;
}
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.telemetry-block {
  border-top: 1px solid var(--border-subtle);
  padding-top: 1.5rem;
}
.block-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}
.form-error {
  color: var(--danger);
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
  max-width: 480px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}
.modal-body {
  padding: 1.5rem;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
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
</style>
