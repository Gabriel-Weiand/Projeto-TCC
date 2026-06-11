<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation } from "@/types";
import { formatLabDateTime } from "@/utils/datetime";
import { effectiveLifecycleStatus } from "@/utils/allocationLifecycle";
import { buildSshCommand, buildSftpCommand } from "@/utils/ssh";

const props = defineProps<{
  allocation: Allocation;
}>();

const emit = defineEmits<{ close: [] }>();

const auth = useAuthStore();
const lab = useLabConfigStore();

const machine = computed(() => props.allocation.machine);

const reservationWindow = computed(() => {
  const { startTime, endTime } = props.allocation;
  if (!startTime || !endTime) return null;
  try {
    return `${formatLabDateTime(startTime, lab.timezone)} → ${formatLabDateTime(endTime, lab.timezone)}`;
  } catch {
    return null;
  }
});

const systemUser = computed(
  () => auth.user?.systemUsername || machine.value?.systemUsername,
);

const isSftpPhase = computed(
  () =>
    effectiveLifecycleStatus(
      props.allocation,
      lab.allocationAccess,
    ) === "sftp",
);

const commandBlocks = computed(() => {
  const ip = machine.value?.ipAddress;
  const publicIp = machine.value?.publicIpAddress?.trim();
  const user = systemUser.value;
  if (!ip || !user) return null;
  const port = machine.value?.sshPort;
  const build = isSftpPhase.value ? buildSftpCommand : buildSshCommand;
  const blocks = [{ id: "local", title: "IP local", command: build(ip, user, port) }];
  if (publicIp) {
    blocks.push({
      id: "public",
      title: "IP público",
      command: build(publicIp, user, port),
    });
  }
  return blocks;
});

const modalTitle = computed(() =>
  isSftpPhase.value ? "Conectar via SFTP" : "Conectar via SSH",
);

const loginLabel = computed(() =>
  isSftpPhase.value ? "Login SFTP" : "Login SSH",
);

const sftpPhaseNotice =
  "Neste período o acesso é apenas para transferência de arquivos via SFTP (sem terminal bash).";

const fingerprint = computed(() => machine.value?.hostFingerprint ?? null);

async function copyCommand(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-glass fade-in connect-modal">
        <div class="modal-header">
          <h2 class="modal-title">{{ modalTitle }}</h2>
          <button type="button" class="btn-close" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <section class="connect-details card">
            <h3 class="connect-details-title">Detalhes da máquina</h3>
            <dl class="connect-details-list">
              <div class="connect-details-row">
                <dt>Nome</dt>
                <dd>{{ machine?.name ?? `Máquina #${allocation.machineId}` }}</dd>
              </div>
              <div v-if="machine?.group?.title" class="connect-details-row">
                <dt>Grupo</dt>
                <dd>{{ machine.group.title }}</dd>
              </div>
              <div v-if="machine?.description?.trim()" class="connect-details-row">
                <dt>Descrição</dt>
                <dd>{{ machine.description }}</dd>
              </div>
              <div v-if="machine?.ipAddress" class="connect-details-row">
                <dt>Endereço IP</dt>
                <dd><code class="connect-inline-code">{{ machine.ipAddress }}</code></dd>
              </div>
              <div v-if="systemUser" class="connect-details-row">
                <dt>{{ loginLabel }}</dt>
                <dd><code class="connect-inline-code">{{ systemUser }}</code></dd>
              </div>
              <div v-if="reservationWindow" class="connect-details-row">
                <dt>Sua reserva</dt>
                <dd>{{ reservationWindow }}</dd>
              </div>
            </dl>
          </section>

          <p v-if="isSftpPhase" class="connect-phase-notice" role="status">
            {{ sftpPhaseNotice }}
          </p>

          <p class="connect-network-note">
            <strong>Rede:</strong>
            o IP informado pode ser alcançável apenas na rede local do
            laboratório.
          </p>

          <div v-if="commandBlocks" class="command-section">
            <label class="field-label">Comando</label>
            <div class="command-blocks">
              <div v-for="block in commandBlocks" :key="block.id" class="command-block">
                <span
                  v-if="commandBlocks.length > 1"
                  class="command-sub-label"
                >
                  {{ block.title }}
                </span>
                <div class="command-row">
                  <code class="command-text">{{ block.command }}</code>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    @click="copyCommand(block.command)"
                  >
                    Copiar
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="connect-warn">
            IP ou usuário do sistema indisponíveis. Verifique se a máquina está
            online e se seu perfil tem o login SSH configurado.
          </p>

          <div class="fingerprint-block">
            <label class="field-label">Fingerprint esperado (host)</label>
            <code v-if="fingerprint" class="fingerprint-value">{{ fingerprint }}</code>
            <p v-else class="connect-warn">
              Fingerprint ainda não registrado pelo agente. Confirme com o
              administrador antes de aceitar a conexão.
            </p>
          </div>
        </div>
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
  overflow-y: auto;
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
  padding: 0 1.5rem 1.25rem;
}

.connect-details {
  padding: 0.85rem 1rem;
  margin: 0;
}

.connect-details-title {
  margin: 0 0 0.65rem;
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.connect-details-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.connect-details-row {
  display: grid;
  grid-template-columns: minmax(5.5rem, 7rem) 1fr;
  gap: 0.5rem 0.75rem;
  align-items: start;
}

.connect-details-row dt {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.connect-details-row dd {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.4;
}

.connect-inline-code {
  font-size: 0.86rem;
  word-break: break-all;
}

.connect-phase-notice {
  margin: 0;
  padding: 0.75rem 0.9rem;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--text-secondary);
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: var(--radius);
}

.connect-network-note {
  margin: 0;
  padding: 0.75rem 0.9rem;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--text-secondary);
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: var(--radius);
}

.command-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.command-blocks {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.command-block {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.command-sub-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.command-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.command-text {
  flex: 1;
  display: block;
  padding: 0.65rem 0.85rem;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 0.88rem;
  word-break: break-all;
}

.fingerprint-value {
  display: block;
  padding: 0.65rem 0.85rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 0.78rem;
  word-break: break-all;
  line-height: 1.45;
}

.connect-warn {
  margin: 0;
  font-size: 0.88rem;
  color: #f59e0b;
}

.field-label {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 0.35rem;
  display: block;
}

</style>
