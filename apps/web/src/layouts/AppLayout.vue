<script setup lang="ts">
import { RouterView, RouterLink, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useRouter } from "vue-router";
import { ref } from "vue";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const mobileMenuOpen = ref(false);

async function handleLogout() {
  await auth.logout();
  router.push({ name: "login" });
}

function isActive(name: string | string[]): boolean {
  if (Array.isArray(name)) return name.includes(route.name as string);
  return route.name === name;
}
</script>

<template>
  <div class="app-layout">
    <nav class="navbar">
      <div class="nav-left">
        <RouterLink to="/" class="nav-brand">
          <span class="brand-icon">◆</span>
          <span class="brand-text">Laboratórios</span>
        </RouterLink>
        <div class="nav-links" :class="{ open: mobileMenuOpen }">
          <RouterLink to="/" :class="{ active: isActive('home') }"
            >Reservas</RouterLink
          >
          <RouterLink
            to="/machines"
            :class="{ active: isActive(['machines', 'machine-detail']) }"
            >Máquinas</RouterLink
          >
          <RouterLink to="/profile" :class="{ active: isActive('profile') }"
            >Perfil</RouterLink
          >

          <template v-if="auth.isAdmin">
            <span class="nav-divider"></span>
            <RouterLink
              to="/admin"
              :class="{ active: isActive('admin-dashboard') }"
              >Painel</RouterLink
            >
            <RouterLink
              to="/admin/users"
              :class="{ active: isActive('admin-users') }"
              >Usuários</RouterLink
            >
            <RouterLink
              to="/admin/machines"
              :class="{ active: isActive('admin-machines') }"
              >Gerenciar</RouterLink
            >
            <RouterLink
              to="/admin/allocations"
              :class="{ active: isActive('admin-allocations') }"
              >Alocações</RouterLink
            >
          </template>
        </div>
      </div>
      <div class="nav-right">
        <span class="nav-user">
          <span v-if="auth.isAdmin" class="admin-dot"></span>
          {{ auth.user?.fullName }}
        </span>
        <button class="btn btn-ghost btn-sm" @click="handleLogout">Sair</button>
        <button class="nav-hamburger" @click="mobileMenuOpen = !mobileMenuOpen">
          ☰
        </button>
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
  height: 56px;
  background: rgba(13, 13, 24, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 50;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  cursor: default;
  user-select: none;
}
.nav-brand:hover {
  color: var(--text-primary);
}
.brand-icon {
  font-size: 1.1rem;
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  cursor: default;
  pointer-events: none;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.nav-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 0.5rem;
}

.nav-links a {
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 500;
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
  gap: 0.75rem;
}

.nav-user {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.admin-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gradient-accent);
  flex-shrink: 0;
}

.nav-hamburger {
  display: none;
  background: none;
  color: var(--text-secondary);
  font-size: 1.3rem;
  padding: 0.25rem;
}

.main-content {
  flex: 1;
  padding: 2rem;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
}

@media (max-width: 900px) {
  .nav-hamburger {
    display: block;
  }
  .nav-links {
    display: none;
    position: absolute;
    top: 56px;
    left: 0;
    right: 0;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-direction: column;
    padding: 1rem;
    gap: 0.25rem;
  }
  .nav-links.open {
    display: flex;
  }
  .nav-divider {
    width: 100%;
    height: 1px;
    margin: 0.5rem 0;
  }
  .nav-user {
    display: none;
  }
}
</style>
