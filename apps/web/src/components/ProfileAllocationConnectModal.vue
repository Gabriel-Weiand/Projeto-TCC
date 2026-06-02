<script setup lang="ts">
import { computed, ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useLabConfigStore } from "@/stores/labConfig";
import type { Allocation } from "@/types";
import { formatLabDateTime } from "@/utils/datetime";
import { buildSshCommand } from "@/utils/ssh";

const props = defineProps<{
  allocation: Allocation;
}>();

const emit = defineEmits<{ close: [] }>();

const auth = useAuthStore();
const lab = useLabConfigStore();
const fingerprintConfirmed = ref(false);

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

const isPrivateIp = computed(() => {
  const ip = machine.value?.ipAddress?.trim();
  if (!ip) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
});
const systemUser = computed(
  () => auth.user?.systemUsername || machine.value?.systemUsername,
);

const sshCommand = computed(() => {
  const ip = machine.value?.ipAddress;
  const user = systemUser.value;
  if (!ip || !user) return null;
  return buildSshCommand(ip, user, machine.value?.sshPort);
});

const fingerprint = computed(() => machine.value?.hostFingerprint ?? null);

const missingConnectInfo = computed(() => {
  if (!sshCommand.value) return "ip_or_user";
  if (!fingerprint.value) return "fingerprint";
  return null;
});

const canProceed = computed(
  () =>
    !!sshCommand.value &&
    (!fingerprint.value || fingerprintConfirmed.value),
);

async function copyCommand() {
  if (!sshCommand.value) return;
  try {
    await navigator.clipboard.writeText(sshCommand.value);
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
          <h2 class="modal-title">Conectar via SSH</h2>
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
                <dt>Login SSH</dt>
                <dd><code class="connect-inline-code">{{ systemUser }}</code></dd>
              </div>
              <div v-if="reservationWindow" class="connect-details-row">
                <dt>Sua reserva</dt>
                <dd>{{ reservationWindow }}</dd>
              </div>
            </dl>
          </section>

          <p class="connect-network-note">
            <strong>Rede:</strong>
            o IP informado costuma ser alcançável apenas na rede local do
            laboratório (Wi‑Fi ou cabo do campus). Se o SSH falhar fora do prédio,
            conecte-se à rede da instituição ou use a VPN indicada pelo suporte do lab.
            <span v-if="isPrivateIp" class="connect-network-private">
              Este endereço é de rede interna (RFC 1918).
            </span>
          </p>

          <div v-if="sshCommand" class="command-block">
            <label class="field-label">Comando</label>
            <div class="command-row">
              <code class="command-text">{{ sshCommand }}</code>
              <button type="button" class="btn btn-ghost btn-sm" @click="copyCommand">
                Copiar
              </button>
            </div>
          </div>
          <p v-else-if="missingConnectInfo === 'ip_or_user'" class="connect-warn">
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
            <label v-if="fingerprint" class="fingerprint-check">
              <input v-model="fingerprintConfirmed" type="checkbox" />
              Comparei o fingerprint do terminal com o valor acima
            </label>
          </div>

          <p class="connect-hint text-muted">
            Na primeira conexão, o SSH pedirá confirmação. O fingerprint exibido
            pelo terminal deve ser <strong>idêntico</strong> ao valor acima.
          </p>

          <p v-if="sshCommand && !canProceed" class="connect-warn">
            Marque a confirmação do fingerprint antes de encerrar este painel.
          </p>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" @click="emit('close')">
            Fechar
          </button>
          <button
            v-if="sshCommand"
            type="button"
            class="btn btn-primary"
            :disabled="!canProceed"
            @click="emit('close')"
          >
            Pronto para conectar
          </button>
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

.connect-network-private {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.78rem;
  opacity: 0.9;
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

.connect-hint {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
}

.field-label {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 0.35rem;
  display: block;
}

.fingerprint-check {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 0.75rem;
  font-size: 0.86rem;
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1.4;
}

.fingerprint-check input {
  margin-top: 0.2rem;
}
</style>
