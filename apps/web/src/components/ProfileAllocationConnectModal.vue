<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "@/stores/auth";
import type { Allocation } from "@/types";

const props = defineProps<{
  allocation: Allocation;
}>();

const emit = defineEmits<{ close: [] }>();

const auth = useAuthStore();

const machine = computed(() => props.allocation.machine);
const systemUser = computed(
  () => auth.user?.systemUsername || machine.value?.systemUsername,
);

const sshCommand = computed(() => {
  const ip = machine.value?.ipAddress;
  const user = systemUser.value;
  if (!ip || !user) return null;
  return `ssh ${user}@${ip}`;
});

const fingerprint = computed(() => machine.value?.hostFingerprint ?? null);

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
          <p class="connect-machine">
            <span class="text-muted">Máquina</span>
            <strong>{{ machine?.name ?? `#${allocation.machineId}` }}</strong>
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

          <p class="connect-hint text-muted">
            Na primeira conexão, o SSH pedirá confirmação. O fingerprint exibido
            pelo terminal deve ser <strong>idêntico</strong> ao valor acima.
          </p>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-primary" @click="emit('close')">
            Fechar
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

.connect-machine {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
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
</style>
