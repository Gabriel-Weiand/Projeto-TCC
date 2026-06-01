<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

const form = reactive({
  fullName: "",
  email: "",
  password: "",
  sshPublicKey: "",
});

const saving = ref(false);
const msg = ref("");
const error = ref("");

onMounted(() => {
  if (auth.user) {
    form.fullName = auth.user.fullName;
    form.email = auth.user.email;
    form.sshPublicKey = auth.user.sshPublicKey || "";
  }
});

async function handleSave() {
  msg.value = "";
  error.value = "";
  if (!auth.user) return;

  const payload: Record<string, string> = {};
  if (form.fullName && form.fullName !== auth.user.fullName)
    payload.fullName = form.fullName;
  if (form.email && form.email !== auth.user.email) 
    payload.email = form.email;
  if (form.password) 
    payload.password = form.password;

  const sshKeyChanged = form.sshPublicKey !== (auth.user.sshPublicKey || "");

  if (Object.keys(payload).length === 0 && !sshKeyChanged) {
    error.value = "Nenhuma alteração detectada.";
    return;
  }

  saving.value = true;
  try {
    // 1. Atualiza dados comuns
    if (Object.keys(payload).length > 0) {
      await auth.updateProfile(auth.user.id, payload);
    }
    // 2. Atualiza a chave SSH
    if (sshKeyChanged) {
      await auth.updateSshKey(form.sshPublicKey);
    }
    
    form.password = "";
    msg.value = "Perfil atualizado com sucesso!";
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 422) error.value = "Dados inválidos. Verifique os campos ou o formato da chave.";
    else error.value = "Erro ao atualizar perfil.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fade-in profile-page">
    <div class="page-header">
      <h1 class="page-title">Perfil</h1>
    </div>

    <div class="card profile-card">
      <div class="profile-avatar">
        <span class="avatar-letter">{{
          auth.user?.fullName?.charAt(0)?.toUpperCase() || "?"
        }}</span>
      </div>

      <div class="profile-info">
        <h2 style="font-weight: 600; margin-bottom: 0.25rem">{{ auth.user?.fullName }}</h2>
        <span class="info-role">
          <span :class="['badge', auth.isAdmin ? 'badge-accent' : 'badge-info']">
            {{ auth.isAdmin ? "Administrador" : "Usuário" }}
          </span>
        </span>
      </div>

      <form class="profile-form" @submit.prevent="handleSave">
        <div class="field">
          <label class="field-label">Nome completo</label>
          <input v-model="form.fullName" type="text" placeholder="Seu nome" />
        </div>
        <div class="field">
          <label class="field-label">Email</label>
          <input v-model="form.email" type="email" placeholder="seu@email.com" />
        </div>

        <div class="field">
          <label class="field-label">Usuário do Sistema (Login SSH)</label>
          <input 
            :value="auth.user?.systemUsername || 'Aguardando...'" 
            type="text" 
            disabled 
          />
        </div>

        <div class="field">
          <label class="field-label"
            >Nova senha
            <span class="text-muted">(deixe em branco para manter)</span></label
          >
          <input
            v-model="form.password"
            type="password"
            placeholder="••••••••"
            autocomplete="new-password"
          />
        </div>

        <div class="ssh-section">
          <h3 class="ssh-title">Acesso Remoto (SSH)</h3>
          
          <div class="ssh-status">
            <span v-if="auth.user?.sshPublicKey" style="color: #10b981; font-weight: 600;">
              ✅ Chave Pública Cadastrada
            </span>
            <span v-else style="color: #ef4444; font-weight: 600;">
              ❌ Nenhuma chave cadastrada
            </span>
          </div>

          <div class="field">
            <label class="field-label">Configurar Nova Chave Pública (ed25519 ou rsa)</label>
            <textarea 
              v-model="form.sshPublicKey" 
              rows="3" 
              placeholder="Cole aqui o conteúdo do seu arquivo ~/.ssh/id_ed25519.pub..."
            ></textarea>
          </div>
        </div>

        <p v-if="msg" class="success-text" style="margin-top: 0.25rem">
          {{ msg }}
        </p>
        <p v-if="error" class="error-text" style="margin-top: 0.25rem">
          {{ error }}
        </p>

        <button
          type="submit"
          class="btn btn-primary"
          :disabled="saving"
          style="margin-top: 0.5rem"
        >
          {{ saving ? "Salvando..." : "Salvar alterações" }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 520px;
}

.profile-card {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  align-items: center;
  text-align: center;
}

.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--gradient-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.avatar-letter {
  font-size: 2rem;
  font-weight: 700;
  color: #fff;
}

.profile-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: center;
}

.profile-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-align: left;
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

/* Campos Padrões */
input, textarea {
  width: 100%;
  padding: 0.6rem 0.8rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.9rem;
  transition:
    border-color var(--transition),
    box-shadow var(--transition);
}

input:focus, textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

/* Novo CSS para Input Desativado (systemUsername) */
input:disabled {
  background: rgba(0, 0, 0, 0.04); /* Fundo mais escuro */
  color: var(--text-muted);
  cursor: not-allowed;
  border-color: var(--border-subtle);
}

/* Novo CSS para Textarea (Chave SSH) */
textarea {
  resize: vertical;
  font-family: monospace;
  font-size: 0.8rem;
}

/* Nova Sessão Visual do SSH */
.ssh-section {
  margin-top: 0.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.ssh-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.ssh-status {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: rgba(0, 0, 0, 0.02); /* Fundo sutil */
  font-size: 0.9rem;
}

/* Modo Dark Automático (se a sua aplicação tiver) */
@media (prefers-color-scheme: dark) {
  input:disabled {
    background: rgba(255, 255, 255, 0.05);
  }
  .ssh-status {
    background: rgba(255, 255, 255, 0.03);
  }
}
</style>