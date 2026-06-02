<script setup lang="ts">
const isSudo = defineModel<boolean>({ default: false });

const props = withDefaults(
  defineProps<{
    /** Menos padding nos cartões (painel lateral de reserva). */
    dense?: boolean;
    /** Título exibido pelo formulário pai. */
    hideLabel?: boolean;
  }>(),
  { dense: false, hideLabel: false },
);
</script>

<template>
  <div class="sudo-choice" :class="{ 'sudo-choice--dense': props.dense }">
    <span v-if="!props.hideLabel" class="field-label sudo-choice-label"
      >Privilégios na máquina</span
    >
    <div class="sudo-choice-row">
      <button
        type="button"
        :class="['preset-btn', { active: !isSudo }]"
        @click="isSudo = false"
      >
        <span class="preset-name">Padrão</span>
        <span class="preset-blurb">Acesso SSH sem privilégios sudo.</span>
      </button>
      <button
        type="button"
        :class="['preset-btn', { active: isSudo }]"
        @click="isSudo = true"
      >
        <span class="preset-name">Sudo</span>
        <span class="preset-blurb">Requer aprovação do administrador.</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sudo-choice-label {
  display: block;
  margin-bottom: 0.35rem;
}

.sudo-choice-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}

@media (max-width: 480px) {
  .sudo-choice-row {
    grid-template-columns: 1fr;
  }
}

.preset-btn {
  text-align: left;
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card-solid);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.preset-btn:hover {
  border-color: var(--border-glass);
  background: var(--bg-hover);
}

.preset-btn.active {
  border-color: var(--text-muted);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.preset-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.preset-blurb {
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.35;
}

.sudo-choice--dense .sudo-choice-row {
  gap: 0.45rem;
}

.sudo-choice--dense .preset-btn {
  padding: 0.5rem 0.6rem;
  gap: 0.15rem;
}

.sudo-choice--dense .preset-name {
  font-size: 0.82rem;
}

.sudo-choice--dense .preset-blurb {
  font-size: 0.68rem;
  line-height: 1.3;
}
</style>
