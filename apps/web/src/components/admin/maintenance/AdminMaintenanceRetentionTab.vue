<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import NumberStepper from "@/components/NumberStepper.vue";
import { useLabConfigStore } from "@/stores/labConfig";
import { useMachinesStore } from "@/stores/machines";
import { useSystemMaintenanceStore } from "@/stores/systemMaintenance";
import type { MaintenanceRunResult } from "@/types";

type PruneKind = "notifications" | "ssh-attempts";

const PRUNE_DAYS_MAX = 3650;

const labStore = useLabConfigStore();
const machinesStore = useMachinesStore();
const maintenanceStore = useSystemMaintenanceStore();

const loading = ref(true);
const lastRun = ref<MaintenanceRunResult | null>(null);
const pruneResult = ref<{ deleted: number; message: string } | null>(null);
const error = ref("");

const pruneKind = ref<PruneKind>("notifications");
const notificationOlderThanDays = ref(30);
const sshKeepDays = ref(30);
const sshMachineId = ref<number | "">("");

const pruneOptions: { value: PruneKind; label: string; hint: string }[] = [
  {
    value: "notifications",
    label: "Notificações",
    hint: "Remove notificações com createdAt anterior ao corte.",
  },
  {
    value: "ssh-attempts",
    label: "Tentativas SSH",
    hint: "Mantém os últimos N dias de tentativas; apaga registros mais antigos.",
  },
];

const maintenanceDefaults = computed(() => labStore.maintenanceConfig);

const selectedPruneHint = computed(
  () => pruneOptions.find((o) => o.value === pruneKind.value)?.hint ?? "",
);

const sortedMachines = computed(() =>
  [...machinesStore.machines].sort((a, b) => a.name.localeCompare(b.name)),
);

function daysToBeforeIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function syncDefaultsFromConfig() {
  notificationOlderThanDays.value =
    maintenanceDefaults.value.pruneNotificationDays;
  sshKeepDays.value = maintenanceDefaults.value.pruneSshAttemptsDays;
}

watch(pruneKind, () => {
  error.value = "";
  pruneResult.value = null;
});

onMounted(async () => {
  try {
    await Promise.all([labStore.fetchConfig(), machinesStore.fetchMachines()]);
    syncDefaultsFromConfig();
  } finally {
    loading.value = false;
  }
});

async function runFullMaintenance() {
  error.value = "";
  pruneResult.value = null;
  try {
    lastRun.value = await maintenanceStore.runMaintenance();
  } catch {
    error.value = "Falha ao executar manutenção.";
  }
}

async function runPrune() {
  error.value = "";
  pruneResult.value = null;
  lastRun.value = null;

  try {
    if (pruneKind.value === "notifications") {
      pruneResult.value = await maintenanceStore.pruneNotifications({
        before: daysToBeforeIso(notificationOlderThanDays.value),
      });
    } else {
      const body: Record<string, unknown> = {
        keepDays: sshKeepDays.value,
      };
      if (sshMachineId.value !== "") {
        body.machineId = sshMachineId.value;
      }
      pruneResult.value = await maintenanceStore.pruneSshAttempts(body);
    }
  } catch {
    error.value = "Falha ao executar limpeza.";
  }
}
</script>

<template>
  <div class="maintenance-tab run-tab">
    <div v-if="loading" class="empty-state">Carregando…</div>

    <template v-else>
      <section class="card action-card">
        <h3 class="section-title">Rotina completa</h3>
        <p class="action-text">
          Executa agora a rotina de manutenção (tokens expirados, resumos TWA e limpeza
          automática de alocações, notificações e tentativas SSH conforme os padrões do
          sistema). A rotina também é executada conforme a frequência configurada na função chron
          em .env na inicialização da API!
        </p>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="maintenanceStore.running || maintenanceStore.pruning"
          @click="runFullMaintenance"
        >
          {{ maintenanceStore.running ? "Executando…" : "Executar agora" }}
        </button>
        <ul v-if="lastRun" class="result-list">
          <li>{{ lastRun.tokens }} token(s) expirado(s) removido(s)</li>
          <li>{{ lastRun.summarized }} resumo(s) TWA gerado(s)</li>
          <li>{{ lastRun.allocations }} alocação(ões) removida(s)</li>
          <li>{{ lastRun.notifications }} notificação(ões) removida(s)</li>
          <li>{{ lastRun.sshAttempts }} tentativa(s) SSH removida(s)</li>
        </ul>
      </section>

      <section class="card prune-card">
        <h3 class="section-title">Limpeza seletiva</h3>
        <p class="tab-lead text-secondary">
          Remove registros antigos de um tipo por vez. Alocações terminadas só são
          removidas pela rotina completa acima (padrão:
          {{ maintenanceDefaults.pruneAllocationDays }} dias após o término).
        </p>

        <div class="prune-field">
          <label class="field-label" for="prune-kind">O que limpar</label>
          <select id="prune-kind" v-model="pruneKind" class="prune-select">
            <option
              v-for="opt in pruneOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
          <p class="field-hint">{{ selectedPruneHint }}</p>
        </div>

        <div
          class="prune-fields-row"
          :class="{ 'prune-fields-row--single': pruneKind === 'notifications' }"
        >
          <div v-if="pruneKind === 'notifications'" class="prune-control-field">
            <NumberStepper
              v-model="notificationOlderThanDays"
              label="Mais antigas que (dias)"
              :min="1"
              :max="PRUNE_DAYS_MAX"
            />
          </div>
          <template v-else>
            <div class="prune-control-field">
              <NumberStepper
                v-model="sshKeepDays"
                label="Manter últimos (dias)"
                :min="1"
                :max="PRUNE_DAYS_MAX"
              />
            </div>
            <div class="prune-control-field">
              <label class="field-label" for="ssh-machine">Máquina</label>
              <select id="ssh-machine" v-model="sshMachineId" class="prune-control-select">
                <option value="">Todas as máquinas</option>
                <option
                  v-for="machine in sortedMachines"
                  :key="machine.id"
                  :value="machine.id"
                >
                  {{ machine.name }}
                </option>
              </select>
            </div>
          </template>
        </div>

        <button
          type="button"
          class="btn btn-danger"
          :disabled="maintenanceStore.running || maintenanceStore.pruning"
          @click="runPrune"
        >
          {{ maintenanceStore.pruning ? "Limpando…" : "Executar limpeza" }}
        </button>

        <p v-if="pruneResult" class="form-ok">
          {{ pruneResult.message }} ({{ pruneResult.deleted }} removido(s))
        </p>
      </section>

      <p v-if="error" class="form-error">{{ error }}</p>
    </template>
  </div>
</template>

<style scoped>
.run-tab {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.tab-lead {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.5;
}

.action-card,
.prune-card {
  padding: 1.25rem 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.action-text {
  font-size: 0.92rem;
  color: var(--text-secondary);
  margin: 0;
}

.result-list {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.prune-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.prune-fields-row {
  --prune-control-h: 2.875rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, max-content));
  gap: 1.25rem 2rem;
  align-items: end;
}

.prune-fields-row--single {
  grid-template-columns: max-content;
}

.prune-control-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: max-content;
  max-width: 100%;
}

.prune-control-field :deep(.num-stepper-field) {
  width: max-content;
}

.prune-control-field :deep(.num-stepper) {
  width: max-content;
  height: var(--prune-control-h);
}

.prune-control-field :deep(.num-stepper-btn) {
  min-width: 2.5rem;
  padding: 0;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.prune-control-field :deep(.num-stepper-input) {
  width: 2.75rem;
  min-width: 2.75rem;
  padding: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.prune-control-select {
  width: 100%;
  min-width: 11.5rem;
  height: var(--prune-control-h);
  padding: 0 0.85rem;
  font-size: 0.92rem;
  font-weight: 600;
  box-sizing: border-box;
}

.field-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.prune-select {
  width: 100%;
  max-width: 320px;
}

@media (max-width: 720px) {
  .prune-fields-row {
    grid-template-columns: 1fr;
    max-width: none;
  }

  .prune-fields-row--single {
    max-width: none;
  }
}

.form-error {
  color: var(--danger);
  margin: 0;
}

.form-ok {
  color: var(--success);
  font-size: 0.88rem;
  margin: 0;
}
</style>
