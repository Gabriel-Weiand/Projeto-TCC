<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AdminMaintenanceTelemetryTab from "@/components/admin/maintenance/AdminMaintenanceTelemetryTab.vue";
import AdminMaintenanceGroupsTab from "@/components/admin/maintenance/AdminMaintenanceGroupsTab.vue";
import AdminMaintenancePoliciesTab from "@/components/admin/maintenance/AdminMaintenancePoliciesTab.vue";
import AdminMaintenanceRetentionTab from "@/components/admin/maintenance/AdminMaintenanceRetentionTab.vue";

const route = useRoute();
const router = useRouter();

const tabs = [
  { id: "telemetria", label: "Telemetria" },
  { id: "grupos", label: "Grupos" },
  { id: "politicas", label: "Políticas" },
  { id: "retencao", label: "Retenção" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const activeTab = ref<TabId>("telemetria");

function tabFromQuery(): TabId {
  const q = route.query.tab;
  if (q === "manutencao") return "retencao";
  if (typeof q === "string" && tabs.some((t) => t.id === q)) {
    return q as TabId;
  }
  return "telemetria";
}

activeTab.value = tabFromQuery();

watch(activeTab, (tab) => {
  if (route.query.tab !== tab) {
    router.replace({ query: { ...route.query, tab } });
  }
});

watch(
  () => route.query.tab,
  () => {
    activeTab.value = tabFromQuery();
  },
);
</script>

<template>
  <div class="fade-in maintenance-page">
    <div class="page-header">
      <h1 class="page-title">Manutenção</h1>
    </div>

    <div class="card maintenance-card">
      <div class="allocation-list maintenance-list">
        <div class="filter-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            :class="['tab-btn', { active: activeTab === tab.id }]"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="maintenance-panel">
          <div class="maintenance-panel-inner">
            <AdminMaintenanceTelemetryTab v-if="activeTab === 'telemetria'" />
            <AdminMaintenanceGroupsTab v-else-if="activeTab === 'grupos'" />
            <AdminMaintenancePoliciesTab v-else-if="activeTab === 'politicas'" />
            <AdminMaintenanceRetentionTab v-else-if="activeTab === 'retencao'" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.maintenance-page {
  max-width: 1280px;
  margin: 0 auto;
}

.maintenance-card {
  padding: 1.25rem 1.5rem;
  text-align: left;
}

.maintenance-list .filter-tabs {
  margin-bottom: 1rem;
}

.maintenance-panel-inner {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  padding: 1.25rem 1.35rem;
  min-height: 200px;
}
</style>
