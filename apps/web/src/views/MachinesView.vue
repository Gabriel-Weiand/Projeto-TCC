<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useMachinesStore } from "@/stores/machines";
import MachineParkInfoModal from "@/components/MachineParkInfoModal.vue";
import MachineParkCard from "@/components/MachineParkCard.vue";
import type { Machine, MachineGroupSummary } from "@/types";
import { DEFAULT_GROUP_TITLE } from "@/stores/machineGroups";
import { useRouter } from "vue-router";

const store = useMachinesStore();
const router = useRouter();
const loading = ref(true);
const search = ref("");
const infoMachine = ref<Machine | null>(null);
/** true = grupo recolhido (só header visível) */
const collapsedGroups = ref<Record<string, boolean>>({});

const GROUP_ORDER = [
  "Máquinas com placa dedicada",
  "Renderização e VFX",
  "Simulações e HPC leve",
  "Uso geral e programação",
];

onMounted(async () => {
  try {
    await store.fetchMachines();
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim();
  if (!q) return store.machines;
  return store.machines.filter((m) => {
    const groupTitle = m.group?.title?.toLowerCase() ?? "";
    return (
      m.name.toLowerCase().includes(q) ||
      (m.description && m.description.toLowerCase().includes(q)) ||
      m.status.toLowerCase().includes(q) ||
      groupTitle.includes(q) ||
      (m.cpuModel && m.cpuModel.toLowerCase().includes(q)) ||
      (m.gpuModel && m.gpuModel.toLowerCase().includes(q))
    );
  });
});

type ParkSection = {
  key: string;
  group: MachineGroupSummary | null;
  machines: Machine[];
};

const parkSections = computed((): ParkSection[] => {
  const byGroup = new Map<string, ParkSection>();

  for (const m of filtered.value) {
    const key = m.group ? `g-${m.group.id}` : "ungrouped";
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        key,
        group: m.group ?? null,
        machines: [],
      });
    }
    byGroup.get(key)!.machines.push(m);
  }

  for (const section of byGroup.values()) {
    section.machines.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  const sections = [...byGroup.values()];
  sections.sort((a, b) => {
    const titleA = a.group?.title ?? DEFAULT_GROUP_TITLE;
    const titleB = b.group?.title ?? DEFAULT_GROUP_TITLE;
    if (titleA === DEFAULT_GROUP_TITLE) return 1;
    if (titleB === DEFAULT_GROUP_TITLE) return -1;
    const idxA = GROUP_ORDER.indexOf(titleA);
    const idxB = GROUP_ORDER.indexOf(titleB);
    const orderA = idxA === -1 ? 998 : idxA;
    const orderB = idxB === -1 ? 998 : idxB;
    if (orderA !== orderB) return orderA - orderB;
    return titleA.localeCompare(titleB, "pt-BR");
  });

  return sections;
});

function goToDetail(m: Machine) {
  router.push({ name: "machine-detail", params: { id: m.id } });
}

function openInfo(m: Machine, event: MouseEvent) {
  event.stopPropagation();
  infoMachine.value = m;
}

function closeInfo() {
  infoMachine.value = null;
}

function isGroupCollapsed(key: string): boolean {
  return collapsedGroups.value[key] ?? false;
}

function toggleGroup(key: string) {
  collapsedGroups.value[key] = !isGroupCollapsed(key);
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

    <div v-else class="park-sections">
      <section
        v-for="section in parkSections"
        :key="section.key"
        class="park-group"
      >
        <button
          type="button"
          class="park-group-header"
          :class="{ 'is-collapsed': isGroupCollapsed(section.key) }"
          :aria-expanded="!isGroupCollapsed(section.key)"
          :aria-label="
            (section.group?.title ?? DEFAULT_GROUP_TITLE) +
            (isGroupCollapsed(section.key)
              ? ' — expandir máquinas'
              : ' — recolher máquinas')
          "
          @click="toggleGroup(section.key)"
        >
          <div class="park-group-header-text">
            <h2 class="park-group-title">
              {{ section.group?.title ?? DEFAULT_GROUP_TITLE }}
            </h2>
            <p v-if="section.group?.description" class="park-group-desc text-secondary">
              {{ section.group.description }}
            </p>
            <span class="park-group-count text-muted">
              {{ section.machines.length }}
              {{ section.machines.length === 1 ? "máquina" : "máquinas" }}
            </span>
          </div>
          <span
            class="park-group-chevron"
            :class="{ 'is-collapsed': isGroupCollapsed(section.key) }"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>

        <div
          class="park-group-body"
          :class="{ 'is-expanded': !isGroupCollapsed(section.key) }"
        >
          <div class="park-group-body-inner">
            <div class="machines-grid">
              <MachineParkCard
                v-for="m in section.machines"
                :key="m.id"
                :machine="m"
                @open="goToDetail(m)"
                @details="openInfo(m, $event)"
              />
            </div>
          </div>
        </div>
      </section>
    </div>

    <MachineParkInfoModal
      v-if="infoMachine"
      :machine="infoMachine"
      @close="closeInfo"
    />
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

.park-sections {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
}

.park-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.55rem 1.25rem 0.65rem 0.75rem;
  font-family: inherit;
  color: inherit;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.2s ease,
    margin-bottom 0.28s ease;
}

.park-group-header:hover {
  background: rgba(255, 255, 255, 0.025);
}

.park-group-header:focus-visible {
  outline: 2px solid rgba(124, 108, 240, 0.45);
  outline-offset: 2px;
}

.park-group-header.is-collapsed {
  margin-bottom: 0;
}

.park-group-header-text {
  min-width: 0;
  flex: 1;
}

.park-group-chevron {
  flex-shrink: 0;
  align-self: center;
  margin-right: 0.15rem;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: rotate(180deg);
  transition:
    transform 0.28s ease,
    color 0.2s ease;
}

.park-group-chevron svg {
  display: block;
}

.park-group-chevron.is-collapsed {
  transform: rotate(0deg);
}

.park-group-header:hover .park-group-chevron {
  color: var(--text-secondary);
}

.park-group-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.32s ease;
}

.park-group-body.is-expanded {
  grid-template-rows: 1fr;
}

.park-group-body-inner {
  overflow: hidden;
  min-height: 0;
  opacity: 0;
  transition: opacity 0.22s ease;
}

.park-group-body.is-expanded .park-group-body-inner {
  opacity: 1;
  transition: opacity 0.28s ease 0.06s;
}

.park-group-title {
  margin: 0 0 0.35rem;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
}

.park-group-desc {
  margin: 0 0 0.4rem;
  font-size: 0.88rem;
  line-height: 1.45;
  max-width: 52rem;
}

.park-group-count {
  font-size: 0.78rem;
}

.machines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}
</style>
