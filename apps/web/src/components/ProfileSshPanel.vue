<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { useAuthStore } from "@/stores/auth";

const emit = defineEmits<{ close: [] }>();

const auth = useAuthStore();
const sshForm = reactive({ sshPublicKey: "" });
const saving = ref(false);
const msg = ref("");
const error = ref("");

function syncFromUser() {
  sshForm.sshPublicKey = auth.user?.sshPublicKey || "";
  msg.value = "";
  error.value = "";
}

watch(() => auth.user?.sshPublicKey, syncFromUser, { immediate: true });

async function handleSaveSsh() {
  msg.value = "";
  error.value = "";

  const trimmed = sshForm.sshPublicKey.trim();
  if (!trimmed) {
    error.value = "Informe a chave pública ed25519.";
    return;
  }

  if (trimmed === (auth.user?.sshPublicKey || "").trim()) {
    error.value = "Nenhuma alteração na chave.";
    return;
  }

  saving.value = true;
  try {
    await auth.updateSshKey(trimmed);
    msg.value = "Chave SSH salva com sucesso.";
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 422)
      error.value = "Chave inválida. Use o formato ssh-ed25519 (arquivo .pub).";
    else error.value = "Erro ao salvar a chave SSH.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <aside class="layout-panel">
    <div class="panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Acesso Remoto (SSH)</h2>
        <button type="button" class="btn-close" aria-label="Fechar" @click="emit('close')">
          ✕
        </button>
      </div>

      <form class="panel-body" @submit.prevent="handleSaveSsh">
        <div
          class="ssh-status-box"
          :class="
            auth.user?.sshPublicKey ? 'ssh-status-box--ok' : 'ssh-status-box--missing'
          "
        >
          <span v-if="auth.user?.sshPublicKey">Chave pública cadastrada</span>
          <span v-else>Nenhuma chave pública cadastrada</span>
        </div>

        <div class="field">
          <label class="field-label">Configurar nova chave pública (ed25519)</label>
          <textarea
            v-model="sshForm.sshPublicKey"
            rows="3"
            placeholder="Cole aqui o conteúdo do seu arquivo ~/.ssh/id_ed25519.pub"
          ></textarea>
        </div>

        <p v-if="msg" class="success-text">{{ msg }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>

        <div class="panel-actions">
          <button type="button" class="btn btn-ghost" @click="emit('close')">
            Fechar
          </button>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            {{ saving ? "Salvando..." : "Salvar chave SSH" }}
          </button>
        </div>
      </form>
    </div>
  </aside>
</template>

<style scoped>
.layout-panel {
  width: 360px;
  flex-shrink: 0;
}

.panel-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  position: sticky;
  top: 80px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}

.panel-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
}

.panel-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.panel-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}

textarea {
  width: 100%;
  padding: 0.6rem 0.8rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.9rem;
  resize: none;
}

textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.ssh-status-box {
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  font-size: 0.9rem;
  font-weight: 500;
}

.ssh-status-box--ok {
  border-color: rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.08);
  color: #34d399;
}

.ssh-status-box--missing {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.08);
  color: #f87171;
}

@media (max-width: 900px) {
  .layout-panel {
    width: 100%;
  }
}
</style>
