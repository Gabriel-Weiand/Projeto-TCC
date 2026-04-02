<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import type { Machine } from "@/types";
import { useRouter } from "vue-router";

const store = useMachinesStore();
const router = useRouter();
const loading = ref(true);
const search = ref("");

onMounted(async () => {
  try {
    await store.fetchMachines();
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return store.machines;
  return store.machines.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      (m.description && m.description.toLowerCase().includes(q)) ||
      m.status.toLowerCase().includes(q),
  );
});

function statusBadge(s: string) {
  const map: Record<string, string> = {
    available: "badge-success",
    occupied: "badge-warning",
    maintenance: "badge-info",
    offline: "badge-danger",
  };
  return map[s] || "badge-muted";
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    available: "Disponível",
    occupied: "Ocupada",
    maintenance: "Manutenção",
    offline: "Offline",
  };
  return map[s] || s;
}

function goToDetail(m: Machine) {
  router.push({ name: "machine-detail", params: { id: m.id } });
}
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Máquinas</h1>
      <div class="search-wrap">
        <input
          v-model="search"
          type="text"
          placeholder="Buscar máquinas..."
          class="search-input"
        />
      </div>
    </div>

    <div v-if="loading" class="empty-state">Carregando...</div>
    <div v-else-if="filtered.length === 0" class="empty-state">
      Nenhuma máquina encontrada.
    </div>

    <div v-else class="machines-grid">
      <div
        v-for="m in filtered"
        :key="m.id"
        class="card machine-card"
        @click="goToDetail(m)"
      >
        <div class="mc-header">
          <h3 class="mc-name">{{ m.name }}</h3>
          <span :class="['badge', statusBadge(m.status)]">{{
            statusLabel(m.status)
          }}</span>
        </div>
        <p class="mc-desc">{{ m.description || "Sem descrição" }}</p>

        <div class="mc-specs">
          <div v-if="m.cpuModel" class="spec-item">
            <span class="spec-label">CPU</span>
            <span class="spec-value">{{ m.cpuModel }}</span>
          </div>
          <div v-if="m.gpuModel" class="spec-item">
            <span class="spec-label">GPU</span>
            <span class="spec-value">{{ m.gpuModel }}</span>
          </div>
          <div v-if="m.totalRamGb" class="spec-item">
            <span class="spec-label">RAM</span>
            <span class="spec-value">{{ m.totalRamGb }} GB</span>
          </div>
          <div v-if="m.totalDiskGb" class="spec-item">
            <span class="spec-label">Disco</span>
            <span class="spec-value">{{ m.totalDiskGb }} GB</span>
          </div>
        </div>

        <div class="mc-footer">
          <span
            v-if="m.loggedUser"
            class="text-secondary"
            style="font-size: 0.8rem"
          >
            Usuário: {{ m.loggedUser }}
          </span>
          <span v-else class="text-muted" style="font-size: 0.8rem"
            >Sem usuário logado</span
          >
          <span class="mc-arrow">→</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-wrap {
  max-width: 280px;
}
.search-input {
  font-size: 0.88rem;
  padding: 0.55rem 0.9rem;
}

.machines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

.machine-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  transition:
    border-color var(--transition),
    transform var(--transition),
    box-shadow var(--transition);
}
.machine-card:hover {
  border-color: rgba(124, 108, 240, 0.2);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}

.mc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mc-name {
  font-size: 1.05rem;
  font-weight: 600;
}
.mc-desc {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.4;
}
.mc-specs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem 1rem;
}
.spec-item {
  display: flex;
  flex-direction: column;
}
.spec-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.spec-value {
  font-size: 0.82rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}
.mc-arrow {
  color: var(--accent);
  font-size: 1rem;
  transition: transform var(--transition);
}
.machine-card:hover .mc-arrow {
  transform: translateX(3px);
}
</style>
