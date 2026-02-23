<script setup lang="ts">
import { RouterView, RouterLink, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useRouter } from "vue-router";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

async function handleLogout() {
  await auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="app-layout">
    <nav class="navbar">
      <div class="nav-left">
        <RouterLink to="/" class="nav-brand">🖥️ Laboratórios</RouterLink>
        <div class="nav-links">
          <RouterLink to="/" :class="{ active: route.name === 'home' }">
            Reservas
          </RouterLink>
          <RouterLink
            to="/machines"
            :class="{ active: route.name === 'machines' }"
          >
            Máquinas
          </RouterLink>
          <RouterLink
            to="/profile"
            :class="{ active: route.name === 'profile' }"
          >
            Perfil
          </RouterLink>
        </div>
      </div>
      <div class="nav-right">
        <span class="nav-user">{{ auth.user?.fullName }}</span>
        <button class="btn btn-ghost btn-sm" @click="handleLogout">Sair</button>
      </div>
    </nav>
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  height: 58px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.nav-brand {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}
.nav-brand:hover {
  color: var(--text-primary);
}

.nav-links {
  display: flex;
  gap: 0.25rem;
}

.nav-links a {
  padding: 0.5rem 0.85rem;
  border-radius: var(--radius);
  font-size: 0.95rem;
  color: var(--text-secondary);
  transition: all var(--transition);
}
.nav-links a:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.nav-links a.active {
  color: var(--accent);
  background: var(--accent-soft);
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.nav-user {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.main-content {
  flex: 1;
  padding: 2rem;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}
</style>
