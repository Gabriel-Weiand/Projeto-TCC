<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import ProfileSshPanel from "@/components/ProfileSshPanel.vue";

const auth = useAuthStore();

const showSshPanel = ref(false);

const form = reactive({
  fullName: "",
  email: "",
  password: "",
});

const saving = ref(false);
const msg = ref("");
const error = ref("");

const hasSshKey = computed(() => !!auth.user?.sshPublicKey?.trim());

onMounted(() => {
  if (auth.user) {
    form.fullName = auth.user.fullName;
    form.email = auth.user.email;
  }
});

function openSshPanel() {
  showSshPanel.value = true;
}

function closeSshPanel() {
  showSshPanel.value = false;
}

async function handleSave() {
  msg.value = "";
  error.value = "";
  if (!auth.user) return;

  const payload: Record<string, string> = {};
  if (form.fullName && form.fullName !== auth.user.fullName)
    payload.fullName = form.fullName;
  if (form.email && form.email !== auth.user.email) payload.email = form.email;
  if (form.password) payload.password = form.password;

  if (Object.keys(payload).length === 0) {
    error.value = "Nenhuma alteração detectada.";
    return;
  }

  saving.value = true;
  try {
    await auth.updateProfile(payload);
    form.password = "";
    msg.value = "Perfil atualizado com sucesso!";
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 422) error.value = "Dados inválidos. Verifique os campos.";
    else error.value = "Erro ao atualizar perfil.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div
    class="fade-in profile-page"
    :class="{ 'profile-page--wide': showSshPanel }"
  >
    <div class="page-header">
      <h1 class="page-title">Perfil</h1>
    </div>

    <div class="account-shell" :class="{ 'account-shell--split': showSshPanel }">
      <div class="profile-main card profile-card">
        <div class="profile-hero">
          <div class="profile-hero-main">
            <div class="profile-avatar">
              <span class="avatar-letter">{{
                auth.user?.fullName?.charAt(0)?.toUpperCase() || "?"
              }}</span>
            </div>
            <div class="profile-info">
              <h2 class="profile-name">{{ auth.user?.fullName }}</h2>
              <span :class="['badge', auth.isAdmin ? 'badge-accent' : 'badge-info']">
                {{ auth.isAdmin ? "Administrador" : "Usuário" }}
              </span>
            </div>
          </div>

          <button
            v-if="!showSshPanel"
            type="button"
            class="ssh-tile"
            :class="hasSshKey ? 'ssh-tile--ok' : 'ssh-tile--missing'"
            @click="openSshPanel"
          >
            <span class="ssh-tile-body">
              <span class="ssh-tile-label">Acesso remoto</span>
              <span class="ssh-tile-hint">
                {{ hasSshKey ? "Chave cadastrada" : "Configurar chave SSH" }}
              </span>
            </span>
            <span class="ssh-tile-arrow" aria-hidden="true">›</span>
          </button>
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

          <p v-if="msg" class="success-text">{{ msg }}</p>
          <p v-if="error" class="error-text">{{ error }}</p>

          <button type="submit" class="btn btn-primary" :disabled="saving">
            {{ saving ? "Salvando..." : "Salvar alterações" }}
          </button>
        </form>
      </div>

      <div v-if="showSshPanel" class="ssh-panel-wrap">
        <ProfileSshPanel @close="closeSshPanel" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 520px;
  margin: 0 auto;
}

.profile-page--wide {
  max-width: 900px;
}

.account-shell {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.account-shell--split {
  flex-direction: row;
  align-items: flex-start;
  gap: 1.5rem;
}

.account-shell--split .profile-main {
  flex: 1;
  min-width: 0;
}

.ssh-panel-wrap {
  flex-shrink: 0;
  width: 360px;
}

.profile-card {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  align-items: stretch;
  text-align: left;
  padding-top: 0;
  overflow: hidden;
}

.profile-hero {
  display: flex;
  align-items: stretch;
  gap: 1rem;
  margin: 0 -1.25rem 0;
  padding: 1.25rem 1.25rem 1.1rem;
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.02);
}

.profile-hero-main {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.profile-avatar {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--gradient-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.avatar-letter {
  font-size: 1.75rem;
  font-weight: 700;
  color: #fff;
}

.profile-info {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: flex-start;
  justify-content: center;
  min-width: 0;
}

.profile-name {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.2;
}

.ssh-tile {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.85rem;
  min-width: 10.5rem;
  max-width: 11.5rem;
  border-radius: var(--radius-lg);
  border: 2px solid var(--border);
  background: var(--bg-card-solid);
  cursor: pointer;
  text-align: left;
  transition:
    background 0.15s,
    border-color 0.15s,
    transform 0.12s;
  flex-shrink: 0;
}

.ssh-tile:hover {
  transform: translateY(-1px);
  background: var(--bg-hover);
}

.ssh-tile--ok {
  border-color: rgba(16, 185, 129, 0.55);
}

.ssh-tile--missing {
  border-color: rgba(239, 68, 68, 0.55);
}

.ssh-tile-body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}

.ssh-tile-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
}

.ssh-tile-hint {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.ssh-tile-arrow {
  font-size: 1rem;
  color: var(--text-muted);
  line-height: 1;
  flex-shrink: 0;
}

.profile-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
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

input {
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

input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

input:disabled {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-muted);
  cursor: not-allowed;
  border-color: var(--border-subtle);
}

@media (prefers-color-scheme: dark) {
  .profile-hero {
    background: rgba(255, 255, 255, 0.03);
  }
  input:disabled {
    background: rgba(255, 255, 255, 0.05);
  }
}

@media (max-width: 640px) {
  .profile-hero {
    flex-direction: column;
    align-items: stretch;
  }

  .ssh-tile {
    max-width: none;
    width: 100%;
  }
}

@media (max-width: 900px) {
  .account-shell--split {
    flex-direction: column;
  }

  .ssh-panel-wrap {
    width: 100%;
  }
}
</style>
