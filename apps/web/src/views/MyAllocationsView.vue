<script setup lang="ts">
import ProfileMyAllocationsTab from "@/components/ProfileMyAllocationsTab.vue";
</script>

<template>
  <div class="fade-in my-allocations-page">
    <div class="page-header">
      <h1 class="page-title">Minhas alocações</h1>
    </div>

    <div class="card allocations-card">
      <ProfileMyAllocationsTab />
    </div>
  </div>
</template>

<style scoped>
.my-allocations-page {
  max-width: 1280px;
  margin: 0 auto;
}

.allocations-card {
  padding: 1.25rem 1.5rem;
  text-align: left;
}
</style>
