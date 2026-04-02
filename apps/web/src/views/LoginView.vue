<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function handleLogin() {
  error.value = "";
  if (!email.value || !password.value) {
    error.value = "Preencha todos os campos.";
    return;
  }
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    router.push({ name: "home" });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 400 || status === 401)
      error.value = "Email ou senha inválidos.";
    else if (status === 422) error.value = "Verifique os dados informados.";
    else error.value = "Erro de conexão com o servidor.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-glow"></div>
    <div class="login-card">
      <div class="login-brand">
        <span class="brand-diamond">◆</span>
      </div>
      <h1 class="login-title">Sistema de Laboratórios</h1>
      <p class="login-subtitle">Entre com suas credenciais</p>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="field">
          <label class="field-label">Email</label>
          <input
            v-model="email"
            type="email"
            placeholder="usuario@ufpel.edu.br"
            autocomplete="email"
            autofocus
          />
        </div>
        <div class="field">
          <label class="field-label">Senha</label>
          <input
            v-model="password"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
          />
        </div>

        <button
          type="submit"
          class="btn btn-primary login-btn"
          :disabled="loading"
        >
          {{ loading ? "Entrando..." : "Entrar" }}
        </button>

        <p
          v-if="error"
          class="error-text"
          style="text-align: center; margin-top: 0.25rem"
        >
          {{ error }}
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 1rem;
}

.login-glow {
  position: absolute;
  width: 500px;
  height: 500px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(
    circle,
    rgba(102, 126, 234, 0.08) 0%,
    transparent 70%
  );
  pointer-events: none;
}

.login-card {
  width: 100%;
  max-width: 400px;
  text-align: center;
  position: relative;
  z-index: 1;
}

.login-brand {
  margin-bottom: 1.5rem;
  user-select: none;
  pointer-events: none;
}

.brand-diamond {
  font-size: 2.5rem;
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 20px rgba(102, 126, 234, 0.4));
  cursor: default;
}

.login-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.35rem;
}

.login-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  margin-bottom: 2rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-align: left;
}

.login-btn {
  margin-top: 0.5rem;
  width: 100%;
  padding: 0.85rem;
  font-size: 1rem;
  font-weight: 600;
}
</style>
