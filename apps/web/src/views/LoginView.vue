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
    if (status === 400 || status === 401) {
      error.value = "Email ou senha inválidos.";
    } else if (status === 422) {
      error.value = "Verifique os dados informados.";
    } else {
      error.value = "Erro de conexão com o servidor.";
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">SISTEMA DE LABORATÓRIOS</h1>

      <div class="login-icon">🔒</div>
      <h2 class="login-subtitle">LOGIN</h2>

      <form @submit.prevent="handleLogin" class="login-form">
        <input
          v-model="email"
          type="email"
          placeholder="Email"
          autocomplete="email"
          autofocus
        />

        <input
          v-model="password"
          type="password"
          placeholder="Senha"
          autocomplete="current-password"
        />

        <button
          type="submit"
          class="btn btn-primary login-btn"
          :disabled="loading"
        >
          {{ loading ? "Entrando..." : "ENTRAR" }}
        </button>

        <p v-if="error" class="login-error">{{ error }}</p>
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
  background: var(--bg-primary);
  padding: 1rem;
}

.login-card {
  width: 100%;
  max-width: 420px;
  text-align: center;
}

.login-title {
  font-size: 0.85rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 2.5rem;
}

.login-icon {
  font-size: 2.5rem;
  margin-bottom: 0.4rem;
}

.login-subtitle {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2.5rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.login-form input {
  padding: 0.9rem 1.1rem;
  font-size: 1rem;
}

.login-btn {
  margin-top: 0.75rem;
  width: 100%;
  padding: 1rem;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.login-error {
  color: var(--danger);
  font-size: 0.9rem;
  margin-top: 0.25rem;
}
</style>
