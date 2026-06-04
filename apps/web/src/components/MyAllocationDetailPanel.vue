<script setup lang="ts">
import { computed } from "vue";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation } from "@/types";
import {
  adminAllocationStatusBadge,
  adminAllocationStatusLabel,
  allocationListStatusBadge,
  allocationListStatusLabel,
  fmtAllocationDateTime,
} from "@/utils/allocationLabels";
import { useMyAllocationActions } from "@/composables/useMyAllocationActions";
import { useAdminAllocationActions } from "@/composables/useAdminAllocationActions";
import { effectiveLifecycleStatus } from "@/utils/allocationLifecycle";

const props = defineProps<{
  allocation: Allocation;
  updating?: boolean;
  deleting?: boolean;
  /** Painel aberto pelo admin (ações de moderação no rodapé). */
  adminMode?: boolean;
  /** Lista oculta — somente leitura. */
  adminReadonly?: boolean;
  summarizing?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  connect: [];
  extend: [];
  statistics: [];
  cancel: [];
  finish: [];
  delete: [];
  approve: [];
  deny: [];
  generateSummary: [];
}>();

const lab = useLabConfigStore();
const actions = useMyAllocationActions();
const adminActions = useAdminAllocationActions((a) =>
  effectiveLifecycleStatus(a, lab.allocationAccess),
);

const machine = computed(() => props.allocation.machine);

const machineLabel = computed(
  () => machine.value?.name ?? `Máquina #${props.allocation.machineId}`,
);

const allocationLifecycle = computed(() =>
  effectiveLifecycleStatus(props.allocation, lab.allocationAccess),
);

const adminStatusOptions = computed(() => ({
  graceEnabled: lab.graceEnabled,
  postSftpEnabled: lab.postSftpEnabled,
}));

const listStatusOptions = computed(() => ({
  graceEnabled: lab.graceEnabled,
  postSftpEnabled: lab.postSftpEnabled,
}));

const statusBadgeClass = computed(() =>
  props.adminMode
    ? adminAllocationStatusBadge(
        props.allocation.status,
        allocationLifecycle.value,
        props.allocation.userHidden,
        adminStatusOptions.value,
      )
    : allocationListStatusBadge(
        props.allocation.status,
        actions.lifecycle(props.allocation),
        listStatusOptions.value,
      ),
);

const statusLabelText = computed(() =>
  props.adminMode
    ? adminAllocationStatusLabel(
        props.allocation.status,
        allocationLifecycle.value,
        props.allocation.userHidden,
        adminStatusOptions.value,
      )
    : allocationListStatusLabel(
        props.allocation.status,
        actions.lifecycle(props.allocation),
        listStatusOptions.value,
      ),
);

const MACHINE_STATUS_LABELS: Record<string, string> = {
  available: "Disponível",
  occupied: "Em uso",
  maintenance: "Manutenção",
  offline: "Offline",
};

function fmt(iso: string) {
  return fmtAllocationDateTime(iso, lab.timezone);
}

/** Descrição cadastral da máquina (sem sufixos de demo no seed, ex. "(semanas)"). */
function machineDescription(desc?: string | null) {
  const t = desc?.trim();
  if (!t) return null;
  return t.replace(/\s*\(semanas\)\s*$/i, "").trim() || t;
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-glass fade-in alloc-detail-modal">
        <div class="modal-header">
          <div class="modal-header-text">
            <h2 class="modal-title">{{ machineLabel }}</h2>
            <span :class="['badge', statusBadgeClass]">
              {{ statusLabelText }}
            </span>
          </div>
          <button type="button" class="btn-close" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <section class="detail-section card">
            <h3 class="detail-section-title">Período da reserva</h3>
            <dl class="detail-dl">
              <div class="detail-row">
                <dt>Início</dt>
                <dd>{{ fmt(allocation.startTime) }}</dd>
              </div>
              <div class="detail-row">
                <dt>Fim</dt>
                <dd>{{ fmt(allocation.endTime) }}</dd>
              </div>
            </dl>
          </section>

          <section
            v-if="adminMode && allocation.user"
            class="detail-section card"
          >
            <h3 class="detail-section-title">Usuário</h3>
            <dl class="detail-dl">
              <div class="detail-row">
                <dt>Nome</dt>
                <dd>{{ allocation.user.fullName }}</dd>
              </div>
              <div class="detail-row">
                <dt>Email</dt>
                <dd>{{ allocation.user.email }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="machine" class="detail-section card">
            <h3 class="detail-section-title">Máquina</h3>
            <dl class="detail-dl">
              <div class="detail-row">
                <dt>Nome</dt>
                <dd>{{ machine.name }}</dd>
              </div>
              <div v-if="machine.group?.title" class="detail-row">
                <dt>Grupo</dt>
                <dd>{{ machine.group.title }}</dd>
              </div>
              <div v-if="machineDescription(machine.description)" class="detail-row">
                <dt>Descrição</dt>
                <dd>{{ machineDescription(machine.description) }}</dd>
              </div>
              <div class="detail-row">
                <dt>Status</dt>
                <dd>
                  {{
                    MACHINE_STATUS_LABELS[machine.status] ?? machine.status
                  }}
                </dd>
              </div>
              <div v-if="machine.ipAddress" class="detail-row">
                <dt>IP</dt>
                <dd><code class="detail-code">{{ machine.ipAddress }}</code></dd>
              </div>
              <div v-if="machine.cpuModel" class="detail-row">
                <dt>CPU</dt>
                <dd>{{ machine.cpuModel }}</dd>
              </div>
              <div v-if="machine.gpuModel" class="detail-row">
                <dt>GPU</dt>
                <dd>{{ machine.gpuModel }}</dd>
              </div>
            </dl>
          </section>

          <section class="detail-section card">
            <h3 class="detail-section-title">Detalhes da solicitação</h3>
            <dl class="detail-dl">
              <div class="detail-row detail-row--block">
                <dt>Motivo</dt>
                <dd class="detail-reason">
                  {{ allocation.reason?.trim() || "—" }}
                </dd>
              </div>
              <div class="detail-row">
                <dt>Criada em</dt>
                <dd>{{ fmt(allocation.createdAt) }}</dd>
              </div>
              <div v-if="allocation.updatedAt" class="detail-row">
                <dt>Atualizada em</dt>
                <dd>{{ fmt(allocation.updatedAt) }}</dd>
              </div>
            </dl>
          </section>

          <p
            v-if="actions.connectPhaseNotice(allocation)"
            class="detail-phase-notice"
            role="status"
          >
            {{ actions.connectPhaseNotice(allocation) }}
          </p>
        </div>

        <footer class="detail-footer">
          <h3 class="detail-footer-title">Ações</h3>
          <template v-if="adminMode">
            <div
              v-if="adminActions.hasActions(allocation, adminReadonly)"
              class="detail-actions"
            >
              <template v-if="adminActions.canApproveDeny(allocation)">
                <button
                  type="button"
                  class="btn btn-sm detail-action-btn btn-approve-outline"
                  :disabled="updating"
                  @click="emit('approve')"
                >
                  {{ updating ? "Salvando…" : "Aprovar" }}
                </button>
                <button
                  type="button"
                  class="btn btn-danger btn-sm detail-action-btn"
                  :disabled="updating"
                  @click="emit('deny')"
                >
                  {{ updating ? "Salvando…" : "Negar" }}
                </button>
              </template>
              <button
                v-if="adminActions.canCancel(allocation)"
                type="button"
                class="btn btn-ghost btn-sm detail-action-btn"
                :disabled="updating"
                @click="emit('cancel')"
              >
                {{ updating ? "Salvando…" : "Cancelar" }}
              </button>
              <button
                v-if="adminActions.canGenerateSummary(allocation)"
                type="button"
                class="btn btn-ghost btn-sm detail-action-btn"
                :disabled="summarizing"
                @click="emit('generateSummary')"
              >
                {{ summarizing ? "Gerando…" : "Gerar resumo" }}
              </button>
              <button
                v-if="adminActions.canViewStatistics(allocation)"
                type="button"
                class="btn btn-ghost btn-sm detail-action-btn"
                @click="emit('statistics')"
              >
                Estatísticas
              </button>
              <button
                v-if="adminActions.canDelete(allocation)"
                type="button"
                class="btn btn-danger btn-sm detail-action-btn"
                :disabled="deleting"
                @click="emit('delete')"
              >
                {{ deleting ? "Excluindo…" : "Excluir" }}
              </button>
            </div>
            <p v-else class="detail-no-actions text-muted">
              Nenhuma ação disponível para esta reserva.
            </p>
          </template>
          <template v-else>
          <div v-if="actions.hasActions(allocation)" class="detail-actions">
            <button
              v-if="actions.showExtendButton(allocation)"
              type="button"
              class="btn btn-ghost btn-sm detail-action-btn"
              @click="emit('extend')"
            >
              Estender
            </button>
            <button
              v-if="actions.showFinishButton(allocation)"
              type="button"
              class="btn btn-ghost btn-sm detail-action-btn"
              :disabled="updating"
              @click="emit('finish')"
            >
              {{ updating ? "Finalizando…" : "Finalizar sessão" }}
            </button>
            <button
              v-if="actions.canCancel(allocation)"
              type="button"
              class="btn btn-danger btn-sm detail-action-btn"
              :disabled="updating"
              @click="emit('cancel')"
            >
              {{ updating ? "Cancelando…" : "Cancelar" }}
            </button>
            <button
              v-if="actions.showConnectButton(allocation)"
              type="button"
              class="btn btn-primary btn-sm detail-action-btn"
              :class="{
                'btn-action--waiting': !actions.canConnectNow(allocation),
              }"
              :disabled="!actions.canConnectNow(allocation)"
              :title="actions.connectDisabledTitle(allocation)"
              @click="emit('connect')"
            >
              Conectar
            </button>
            <button
              v-if="actions.showStatistics(allocation)"
              type="button"
              class="btn btn-ghost btn-sm detail-action-btn"
              @click="emit('statistics')"
            >
              Estatísticas
            </button>
            <button
              v-if="actions.canRemoveFromHistory(allocation)"
              type="button"
              class="btn btn-ghost btn-sm detail-action-btn"
              :disabled="deleting"
              @click="emit('delete')"
            >
              {{ deleting ? "Removendo…" : "Remover" }}
            </button>
          </div>
          <p v-else class="detail-no-actions text-muted">
            Nenhuma ação disponível para esta reserva.
          </p>
          </template>
        </footer>
      </div>
    </div>
  </Teleport>
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
  max-width: 520px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.alloc-detail-modal .modal-body {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-header-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.modal-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  line-height: 1.3;
}

.modal-body {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detail-section {
  padding: 0.85rem 1rem;
  margin: 0;
}

.detail-section-title {
  margin: 0 0 0.65rem;
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.detail-dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-row {
  display: grid;
  grid-template-columns: minmax(5.5rem, 7rem) 1fr;
  gap: 0.5rem 0.75rem;
  align-items: start;
}

.detail-row--block {
  grid-template-columns: 1fr;
  gap: 0.25rem;
}

.detail-row dt {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.detail-row dd {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.4;
}

.detail-reason {
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-code {
  font-size: 0.86rem;
  word-break: break-all;
}

.detail-footer {
  flex-shrink: 0;
  padding: 1rem 1.5rem 1.35rem;
  border-top: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.12);
}

.detail-footer-title {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  text-align: center;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.detail-action-btn {
  min-width: 5.5rem;
}

.detail-no-actions {
  margin: 0;
  font-size: 0.85rem;
  text-align: center;
}

.detail-phase-notice {
  margin: 0;
  padding: 0.65rem 0.85rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--text-secondary);
  background: rgba(255, 193, 7, 0.08);
  border: 1px solid rgba(255, 193, 7, 0.22);
  border-radius: var(--radius-md);
}

.btn-action--waiting:disabled {
  opacity: 0.35;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  box-shadow: none;
}

.btn-approve-outline {
  color: var(--success);
  background: transparent;
  border: 1px solid rgba(52, 211, 153, 0.55);
}

.btn-approve-outline:hover:not(:disabled) {
  background: var(--success-soft);
  border-color: var(--success);
  color: var(--success);
}
</style>
