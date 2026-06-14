<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMachinesStore } from "@/stores/machines";
import { useMachineGroupsStore } from "@/stores/machineGroups";
import MachineTelemetryPanel from "@/components/MachineTelemetryPanel.vue";
import AdminMachineDisksTab from "@/components/admin/machine/AdminMachineDisksTab.vue";
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
  { id: "discos", label: "Discos" },
  { id: "telemetria", label: "Telemetria" },
  { id: "usuarios", label: "Usuários" },
  { id: "ssh", label: "SSH" },
] as const;

const form = reactive({
  name: "",
  description: "",
  cpuModel: "",
  gpuModel: "",
  totalRamGb: "",
  totalVramGb: "",
  totalDiskGb: "",
  ipAddress: "",
  publicIpAddress: "",
  sshPort: "",
  operationalMode: "available" as MachineOperationalMode,
  machineGroupId: "" as string,
});

const tokenModal = ref(false);
const tokenValue = ref("");

const backLabel = computed(() =>
  route.query.from === "machine-detail"
    ? "← Ver máquina"
    : "← Gerenciar máquinas",
);

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

function parseOptionalGb(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function loadForm(m: Machine) {
  form.name = m.name;
  form.description = m.description || "";
  form.cpuModel = m.cpuModel || "";
  form.gpuModel = m.gpuModel || "";
  form.totalRamGb = m.totalRamGb != null ? String(m.totalRamGb) : "";
  form.totalVramGb = m.totalVramGb != null ? String(m.totalVramGb) : "";
  form.totalDiskGb = m.totalDiskGb != null ? String(m.totalDiskGb) : "";
  form.ipAddress = m.ipAddress || "";
  form.publicIpAddress = m.publicIpAddress || "";
  form.sshPort = m.sshPort != null ? String(m.sshPort) : "";
  form.operationalMode = resolveOperationalMode(m);
  form.machineGroupId =
    m.machineGroupId != null ? String(m.machineGroupId) : "";
}

function goBack() {
  if (route.query.from === "machine-detail") {
    router.push({
      name: "machine-detail",
      params: { id: machineId.value },
      query: { from: "admin" },
    });
    return;
  }
  router.push({ name: "admin-machines" });
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
      cpuModel: form.cpuModel.trim() || null,
      gpuModel: form.gpuModel.trim() || null,
      totalRamGb: parseOptionalGb(form.totalRamGb),
      totalVramGb: parseOptionalGb(form.totalVramGb),
      totalDiskGb: parseOptionalGb(form.totalDiskGb),
      ipAddress: form.ipAddress.trim() || null,
      publicIpAddress: form.publicIpAddress.trim() || null,
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
  <div class="fade-in machine-edit-page">
    <div class="page-header">
      <button type="button" class="btn btn-ghost btn-sm back-btn" @click="goBack">
        {{ backLabel }}
      </button>
      <h1 v-if="machine" class="page-title">Editar — {{ machine.name }}</h1>
      <h1 v-else class="page-title">Editar máquina</h1>
    </div>

    <div v-if="loading" class="empty-state">Carregando…</div>

    <div v-else-if="machine" class="card edit-card">
      <div class="allocation-list edit-list">
        <div class="filter-tabs">
          <button
            v-for="tab in editTabs"
            :key="tab.id"
            type="button"
            :class="['tab-btn', { active: activeTab === tab.id }]"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="edit-panel">
          <div class="edit-panel-inner">
            <form
              v-if="activeTab === 'infos'"
              class="infos-form"
              @submit.prevent="handleSave"
            >
              <div class="field">
                <label class="field-label">Nome</label>
                <input v-model="form.name" type="text" />
              </div>
              <div class="field">
                <label class="field-label">Descrição</label>
                <textarea v-model="form.description" class="field-textarea" rows="2" />
              </div>

              <div class="hardware-section">
                <h3 class="section-subtitle">Hardware (specs)</h3>
                <p class="field-hint text-muted hardware-hint">
                  Campos vazios são preenchidos pelo agente no sync-specs. Valores salvos aqui
                  não são sobrescritos — limpe o campo para permitir nova detecção.
                </p>
                <div class="hardware-grid">
                  <div class="field">
                    <label class="field-label">CPU</label>
                    <input
                      v-model="form.cpuModel"
                      type="text"
                      placeholder="Ex.: Intel Core i7-11700"
                    />
                  </div>
                  <div class="field">
                    <label class="field-label">GPU</label>
                    <input
                      v-model="form.gpuModel"
                      type="text"
                      placeholder="Ex.: NVIDIA RTX 4090 D"
                    />
                  </div>
                  <div class="field">
                    <label class="field-label">RAM (GB)</label>
                    <input
                      v-model="form.totalRamGb"
                      type="text"
                      inputmode="decimal"
                      placeholder="Ex.: 48"
                    />
                  </div>
                  <div class="field">
                    <label class="field-label">VRAM (GB)</label>
                    <input
                      v-model="form.totalVramGb"
                      type="text"
                      inputmode="decimal"
                      placeholder="Ex.: 24"
                    />
                  </div>
                  <div class="field">
                    <label class="field-label">Disco (GB)</label>
                    <input
                      v-model="form.totalDiskGb"
                      type="text"
                      inputmode="decimal"
                      placeholder="Ex.: 2480"
                    />
                  </div>
                </div>
              </div>

              <div class="field">
                <label class="field-label">IP local</label>
                <input
                  v-model="form.ipAddress"
                  type="text"
                  placeholder="Ex.: arendt.lab.local"
                />
                <p class="field-hint text-muted">
                  Preenchido pelo agente no sync se vazio. Valor salvo aqui não é sobrescrito —
                  limpe o campo para permitir nova detecção.
                </p>
              </div>
              <div class="field">
                <label class="field-label">IP alternativo</label>
                <input
                  v-model="form.publicIpAddress"
                  type="text"
                  placeholder="Ex.: NAT, DNS ou rota externa"
                />
                <p class="field-hint text-muted">
                  Somente admin — não é obtido pelo agente. Opcional, para orientar conexões
                  externas ao laboratório.
                </p>
              </div>
              <div class="field">
                <label class="field-label">
                  Porta SSH <span class="text-muted">(vazio = 22)</span>
                </label>
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

            <div v-else-if="activeTab === 'telemetria'" class="telemetry-tab">
              <MachineTelemetryPanel :machine="machine" @saved="onTelemetrySaved" />
            </div>

            <AdminMachineDisksTab
              v-else-if="activeTab === 'discos'"
              :machine="machine"
              @saved="onTelemetrySaved"
            />

            <AdminMachineUsersTab
              v-else-if="activeTab === 'usuarios'"
              :machine="machine"
            />
            <AdminMachineSshTab v-else-if="activeTab === 'ssh'" :machine="machine" />
          </div>
        </div>
      </div>
    </div>

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
.machine-edit-page {
  max-width: 1280px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  margin-bottom: 1.25rem;
}

.back-btn {
  padding-left: 0;
}

.edit-card {
  padding: 1.25rem 1.5rem;
  text-align: left;
}

.edit-list .filter-tabs {
  margin-bottom: 1rem;
}

.edit-panel-inner {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  padding: 1.25rem 1.35rem;
  min-height: 200px;
}

.infos-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 720px;
}

.hardware-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.section-subtitle {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.hardware-hint {
  margin: 0;
}

.hardware-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

@media (max-width: 640px) {
  .hardware-grid {
    grid-template-columns: 1fr;
  }
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
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
