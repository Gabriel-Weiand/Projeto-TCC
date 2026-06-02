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

function toggleSshPanel() {
  showSshPanel.value = !showSshPanel.value;
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
  <div class="fade-in profile-page">
    <div class="account-shell">
      <div class="profile-column">
        <div class="page-header">
          <h1 class="page-title">Perfil</h1>
        </div>

        <div class="profile-row" :class="{ 'profile-row--ssh-open': showSshPanel }">
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
            @click="toggleSshPanel"
          >
            <span class="ssh-tile-body">
              <span class="ssh-tile-label">Acesso remoto</span>
              <span class="ssh-tile-hint">
                {{ hasSshKey ? "Chave cadastrada" : "Configurar chave SSH" }}
              </span>
            </span>
            <span class="ssh-tile-chevron" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
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

        <aside class="ssh-panel-aside" :class="{ 'is-open': showSshPanel }">
          <ProfileSshPanel @close="closeSshPanel" />
        </aside>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  width: 100%;
  max-width: 100%;
}

.profile-column {
  width: fit-content;
  max-width: 100%;
}

.profile-column .page-header {
  margin-bottom: 1.75rem;
}

.account-shell {
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
}

.profile-row {
  display: flex;
  align-items: flex-start;
  gap: 0;
  transition: gap 0.32s ease;
}

.profile-row--ssh-open {
  gap: 1.5rem;
}

.profile-main {
  flex: 0 0 520px;
  width: 520px;
  max-width: 100%;
  min-width: 0;
}

.ssh-panel-aside {
  flex: 0 0 auto;
  width: 360px;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition:
    max-width 0.32s ease,
    opacity 0.28s ease;
}

.ssh-panel-aside.is-open {
  max-width: 360px;
  opacity: 1;
  pointer-events: auto;
}

.ssh-panel-aside.is-open :deep(.panel-card) {
  position: static;
  top: auto;
}

@media (prefers-reduced-motion: reduce) {
  .account-shell,
  .ssh-panel-aside {
    transition: none;
  }
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

.ssh-tile-chevron {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition:
    transform 0.28s ease,
    color 0.2s ease;
}

.ssh-tile-chevron svg {
  display: block;
}

.ssh-tile:hover .ssh-tile-chevron {
  color: var(--text-secondary);
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
  .profile-column,
  .profile-main {
    width: 100%;
  }

  .account-shell {
    width: 100%;
    max-width: 520px;
  }

  .profile-row,
  .profile-row--ssh-open {
    flex-direction: column;
    gap: 1rem;
  }

  .ssh-panel-aside {
    width: 100%;
  }

  .ssh-panel-aside.is-open {
    max-width: 100%;
  }
}
</style>
