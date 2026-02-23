<script setup lang="ts">
import { onMounted } from "vue";
import { useMachinesStore } from "@/stores/machines";

const machinesStore = useMachinesStore();

onMounted(() => {
  machinesStore.fetchMachines();
});

function statusIcon(status: string): string {
  const map: Record<string, string> = {
    available: "🟢",
    occupied: "🔴",
    maintenance: "🟡",
    offline: "⚫",
  };
  return map[status] || "⚪";
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    available: "Disponível",
    occupied: "Ocupada",
    maintenance: "Manutenção",
    offline: "Offline",
  };
  return map[status] || status;
}
</script>

<template>
  <div class="machines-page">
    <h2 class="page-title">Máquinas do Laboratório</h2>

    <div v-if="machinesStore.loading" class="text-muted mt-2">
      Carregando...
    </div>

    <div v-else class="machine-grid">
      <div v-for="m in machinesStore.machines" :key="m.id" class="machine-card">
        <div class="machine-header">
          <span class="machine-name">{{ m.name }}</span>
          <span class="machine-status"
            >{{ statusIcon(m.status) }} {{ statusLabel(m.status) }}</span
          >
        </div>
        <p class="machine-desc">{{ m.description }}</p>
        <div class="machine-specs">
          <div v-if="m.cpuModel" class="spec">
            <span class="spec-label">CPU</span>
            <span>{{ m.cpuModel }}</span>
          </div>
          <div v-if="m.gpuModel" class="spec">
            <span class="spec-label">GPU</span>
            <span>{{ m.gpuModel }}</span>
          </div>
          <div class="spec-row">
            <div v-if="m.totalRamGb" class="spec">
              <span class="spec-label">RAM</span>
              <span>{{ m.totalRamGb }} GB</span>
            </div>
            <div v-if="m.totalDiskGb" class="spec">
              <span class="spec-label">Disco</span>
              <span>{{ m.totalDiskGb }} GB</span>
            </div>
          </div>
          <div v-if="m.loggedUser" class="spec">
            <span class="spec-label">Usuário logado</span>
            <span>{{ m.loggedUser }}</span>
          </div>
        </div>
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

.machine-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

.machine-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.25rem 1.5rem;
}

.machine-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.machine-name {
  font-weight: 700;
  font-size: 1.1rem;
}

.machine-status {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.machine-desc {
  font-size: 0.9rem;
  color: var(--text-muted);
  margin-bottom: 0.85rem;
}

.machine-specs {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.spec {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.spec-label {
  background: var(--bg-input);
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  font-weight: 600;
  font-size: 0.72rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  min-width: 45px;
  text-align: center;
}

.spec-row {
  display: flex;
  gap: 1rem;
}
</style>
