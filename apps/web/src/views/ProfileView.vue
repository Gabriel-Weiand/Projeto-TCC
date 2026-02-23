<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
</script>

<template>
  <div class="profile-page">
    <h2 class="page-title">Perfil</h2>

    <div class="profile-card">
      <div class="profile-avatar">
        {{ auth.user?.fullName?.charAt(0).toUpperCase() }}
      </div>
      <div class="profile-info">
        <h3>{{ auth.user?.fullName }}</h3>
        <p class="text-secondary">{{ auth.user?.email }}</p>
        <span class="role-badge">{{
          auth.user?.role === "admin" ? "Administrador" : "Usuário"
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 2rem;
}

.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.75rem;
  font-weight: 700;
  flex-shrink: 0;
}

.profile-info h3 {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 0.3rem;
}

.role-badge {
  display: inline-block;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.25rem 0.7rem;
  border-radius: 20px;
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
