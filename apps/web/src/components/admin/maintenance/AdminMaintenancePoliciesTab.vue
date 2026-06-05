<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useLabConfigStore } from "@/stores/labConfig";
import type { PolicyMode } from "@/types";

const labStore = useLabConfigStore();
const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const error = ref("");

const form = reactive({
  requireAdminApproval: "auto" as PolicyMode,
  publicNames: "auto" as PolicyMode,
});

const envDefaults = reactive({
  requireAdminApproval: false,
  publicNames: false,
});

const policyOptions: { value: PolicyMode; label: string }[] = [
  { value: "auto", label: "Auto (valor do .env)" },
  { value: "true", label: "Ativado (fixo)" },
  { value: "false", label: "Desativado (fixo)" },
];

function policyStateLabel(enabled: boolean): string {
  return enabled ? "ativado" : "desativado";
}

onMounted(async () => {
  try {
    const settings = await labStore.fetchLabSettings();
    form.requireAdminApproval = settings.requireAdminApproval;
    form.publicNames = settings.publicNames;
    envDefaults.requireAdminApproval = settings.env.requireAdminApproval;
    envDefaults.publicNames = settings.env.publicNames;
  } finally {
    loading.value = false;
  }
});

async function handleSave() {
  error.value = "";
  saved.value = false;
  saving.value = true;
  try {
    const settings = await labStore.saveLabSettings({
      requireAdminApproval: form.requireAdminApproval,
      publicNames: form.publicNames,
    });
    envDefaults.requireAdminApproval = settings.env.requireAdminApproval;
    envDefaults.publicNames = settings.env.publicNames;
    saved.value = true;
  } catch {
    error.value = "Não foi possível salvar as políticas.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="maintenance-tab policies-tab">
    <div v-if="loading" class="empty-state">Carregando…</div>

    <template v-else>
      <p class="tab-lead text-secondary">
        Políticas operacionais sem reiniciar a API. Em <strong>Auto</strong>, o comportamento
        segue o que está no <code>.env</code> da API
        (<code>LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL</code> e
        <code>LAB_ALLOCATION_PUBLIC_NAMES</code>).
        <strong>Ativado</strong> ou <strong>Desativado</strong> fixam o valor até voltar para
        Auto — isso grava em <code>runtime_settings.json</code> e sobrescreve o
        <code>.env</code> enquanto durar.
      </p>

      <div class="card policy-card">
        <div class="policy-grid">
          <div class="policy-field">
            <label class="policy-label" for="policy-approval">
              Exigir aprovação admin para novas reservas
            </label>
            <select
              id="policy-approval"
              v-model="form.requireAdminApproval"
              class="policy-select"
            >
              <option
                v-for="opt in policyOptions"
                :key="`approval-${opt.value}`"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
            <p class="policy-hint">
              <template v-if="form.requireAdminApproval === 'auto'">
                Padrão do .env:
                {{ policyStateLabel(envDefaults.requireAdminApproval) }}
              </template>
              <template v-else>
                Fixo em {{ policyStateLabel(form.requireAdminApproval === "true") }} (ignora
                .env até voltar para Auto)
              </template>
            </p>
          </div>

          <div class="policy-field">
            <label class="policy-label" for="policy-names">
              Nomes visíveis no calendário para todos
            </label>
            <select id="policy-names" v-model="form.publicNames" class="policy-select">
              <option
                v-for="opt in policyOptions"
                :key="`names-${opt.value}`"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
            <p class="policy-hint">
              <template v-if="form.publicNames === 'auto'">
                Padrão do .env: {{ policyStateLabel(envDefaults.publicNames) }}
              </template>
              <template v-else>
                Fixo em {{ policyStateLabel(form.publicNames === "true") }} (ignora .env até
                voltar para Auto)
              </template>
            </p>
          </div>
        </div>
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>
      <p v-if="saved" class="form-ok">Políticas salvas.</p>

      <button
        type="button"
        class="btn btn-primary"
        :disabled="saving"
        @click="handleSave"
      >
        {{ saving ? "Salvando…" : "Salvar políticas" }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.tab-lead {
  margin: 0 0 1.25rem;
  font-size: 0.9rem;
  line-height: 1.5;
}

.tab-lead code {
  font-size: 0.82rem;
}

.policy-card {
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}

.policy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem 1.25rem;
}

.policy-field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.policy-label {
  font-weight: 500;
  font-size: 0.92rem;
  line-height: 1.35;
}

.policy-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.policy-select {
  width: 100%;
}

.form-error {
  color: var(--danger);
}

.form-ok {
  color: var(--success);
  font-size: 0.88rem;
}

@media (max-width: 720px) {
  .policy-grid {
    grid-template-columns: 1fr;
  }
}
</style>
