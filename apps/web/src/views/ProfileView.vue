<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

const form = reactive({
  fullName: "",
  email: "",
  password: "",
});

const saving = ref(false);
const msg = ref("");
const error = ref("");

onMounted(() => {
  if (auth.user) {
    form.fullName = auth.user.fullName;
    form.email = auth.user.email;
  }
});

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
    await auth.updateProfile(auth.user.id, payload);
    form.password = "";
    msg.value = "Perfil atualizado com sucesso!";
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 422) error.value = "Dados inválidos. Verifique os campos.";
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
        <span class="info-role">
          <span
            :class="['badge', auth.isAdmin ? 'badge-accent' : 'badge-info']"
          >
            {{ auth.isAdmin ? "Administrador" : "Usuário" }}
          </span>
        </span>
        <span class="text-muted" style="font-size: 0.82rem">
          Membro desde
          {{ new Date(auth.user?.createdAt || "").toLocaleDateString("pt-BR") }}
        </span>
      </div>

      <form class="profile-form" @submit.prevent="handleSave">
        <div class="field">
          <label class="field-label">Nome completo</label>
          <input v-model="form.fullName" type="text" placeholder="Seu nome" />
        </div>
        <div class="field">
          <label class="field-label">Email</label>
          <input
            v-model="form.email"
            type="email"
            placeholder="seu@email.com"
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
  box-shadow: 0 4px 20px var(--accent-glow);
}
.avatar-letter {
  font-size: 1.75rem;
  font-weight: 700;
  color: #fff;
}

.profile-info {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: center;
}

.profile-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-align: left;
}
</style>
