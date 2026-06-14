<script setup lang="ts">
const collapsed = defineModel<boolean>("collapsed", { default: false });

defineProps<{
  title: string;
}>();

function toggle() {
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <section class="collapse-section">
    <button
      type="button"
      class="collapse-header"
      :class="{ 'is-collapsed': collapsed }"
      :aria-expanded="!collapsed"
      @click="toggle"
    >
      <h2 class="collapse-title">{{ title }}</h2>
      <div v-if="$slots['header-extra']" class="collapse-header-extra">
        <slot name="header-extra" />
      </div>
      <span
        class="collapse-chevron"
        :class="{ 'is-collapsed': collapsed }"
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

    <div class="collapse-body" :class="{ 'is-expanded': !collapsed }">
      <div class="collapse-body-inner">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.collapse-section {
  margin-bottom: 0.5rem;
}

.collapse-header {
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

.collapse-header:hover {
  background: rgba(255, 255, 255, 0.025);
}

.collapse-header:focus-visible {
  outline: 2px solid rgba(124, 108, 240, 0.45);
  outline-offset: 2px;
}

.collapse-header.is-collapsed {
  margin-bottom: 0;
}

.collapse-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.collapse-header-extra {
  margin-left: auto;
  margin-right: 0.35rem;
  font-size: 0.82rem;
  font-weight: 400;
  color: var(--text-secondary);
  white-space: nowrap;
}

.collapse-chevron {
  flex-shrink: 0;
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

.collapse-chevron svg {
  display: block;
}

.collapse-chevron.is-collapsed {
  transform: rotate(0deg);
}

.collapse-header:hover .collapse-chevron {
  color: var(--text-secondary);
}

.collapse-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.32s ease;
}

.collapse-body.is-expanded {
  grid-template-rows: 1fr;
}

.collapse-body-inner {
  overflow: hidden;
  min-height: 0;
  opacity: 0;
  transition: opacity 0.22s ease;
}

.collapse-body.is-expanded .collapse-body-inner {
  opacity: 1;
  transition: opacity 0.28s ease 0.06s;
}
</style>
