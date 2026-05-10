<script setup lang="ts">
// Simple hub to navigate between the 3 calendar prototypes
</script>

<template>
  <div class="fade-in">
    <div class="page-header">
      <h1 class="page-title">Protótipos — Novo Calendário</h1>
    </div>

    <p class="text-secondary" style="margin-bottom: 2rem; font-size: 0.95rem">
      Três propostas de calendário mensal para substituição da visão semanal atual.
      Avalie cada uma e escolha a que melhor se adapta ao fluxo do laboratório.
    </p>

    <div class="proto-cards">
      <!-- Prototype A -->
      <div class="proto-card">
        <div class="proto-card-badge">A</div>
        <div class="proto-card-content">
          <h2 class="proto-card-title">Gantt Timeline</h2>
          <p class="proto-card-desc">
            Máquinas como linhas horizontais; barras coloridas representam alocações
            que se estendem por vários dias. Ideal para visualizar simulações longas
            e detectar conflitos rapidamente.
          </p>
          <ul class="proto-card-features">
            <li>Barras multi-dia por máquina</li>
            <li>Linha vertical "Hoje"</li>
            <li>Cor por usuário/máquina</li>
            <li>Navegação mensal</li>
          </ul>
          <router-link to="/lab/calendar-gantt" class="btn btn-primary">
            Ver Protótipo A →
          </router-link>
        </div>
      </div>

      <!-- Prototype B -->
      <div class="proto-card">
        <div class="proto-card-badge">B</div>
        <div class="proto-card-content">
          <h2 class="proto-card-title">Grade Mensal</h2>
          <p class="proto-card-desc">
            Visão clássica de calendário com semanas em linhas e dias em colunas.
            Cada célula exibe chips coloridos das máquinas alocadas. Clicar no dia
            abre um painel lateral com detalhes.
          </p>
          <ul class="proto-card-features">
            <li>Grade tradicional Seg → Dom</li>
            <li>Chips por máquina/dia</li>
            <li>Painel lateral com detalhes</li>
            <li>Destacar dia atual</li>
          </ul>
          <router-link to="/lab/calendar-grid" class="btn btn-primary">
            Ver Protótipo B →
          </router-link>
        </div>
      </div>

      <!-- Prototype C -->
      <div class="proto-card">
        <div class="proto-card-badge">C</div>
        <div class="proto-card-content">
          <h2 class="proto-card-title">Mapa de Disponibilidade</h2>
          <p class="proto-card-desc">
            Heatmap compacto: linhas são máquinas, colunas são os dias do mês.
            A intensidade da cor indica o nível de ocupação. A coluna final mostra
            a taxa de ocupação mensal por máquina.
          </p>
          <ul class="proto-card-features">
            <li>Visão de 30 dias de uma só vez</li>
            <li>Intensidade de cor por ocupação</li>
            <li>Taxa de ocupação mensal</li>
            <li>Clique na célula para detalhes</li>
          </ul>
          <router-link to="/lab/calendar-matrix" class="btn btn-primary">
            Ver Protótipo C →
          </router-link>
        </div>
      </div>

      <!-- Prototype D -->
      <div class="proto-card proto-card-highlight">
        <div class="proto-card-badge">D</div>
        <div class="proto-card-content">
          <h2 class="proto-card-title">Gantt Rolagem Contínua</h2>
          <p class="proto-card-desc">
            Versão evoluída do Gantt A — sem paginação por mês. A linha do tempo é
            contínua (30 dias passados + 60 futuros). Role horizontalmente arrastando,
            usando o scroll do mouse ou as setas. Sem barra de rolagem visível.
          </p>
          <ul class="proto-card-features">
            <li>Timeline contínua sem botões de mês</li>
            <li>Indicador dinâmico do mês visível</li>
            <li>Separadores visuais de mês</li>
            <li>Scroll por arraste, roda ou setas</li>
            <li>Sem barra de rolagem inferior</li>
          </ul>
          <router-link to="/lab/calendar-gantt-scroll" class="btn btn-primary">
            Ver Protótipo D →
          </router-link>
        </div>
      </div>
    </div>

    <div class="back-note">
      <span class="text-muted" style="font-size:0.82rem">
        ℹ️ Nenhum componente existente foi alterado. Estes protótipos existem apenas em
        <code>/src/views/prototypes/</code> e nas rotas <code>/lab/*</code>.
      </span>
    </div>
  </div>
</template>

<style scoped>
.proto-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.25rem;
  margin-bottom: 2rem;
}

.proto-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.proto-card:hover {
  border-color: rgba(124, 108, 240, 0.35);
  box-shadow: 0 4px 24px rgba(124, 108, 240, 0.12);
}

.proto-card-highlight {
  border-color: rgba(124, 108, 240, 0.3);
  box-shadow: 0 0 0 1px rgba(124, 108, 240, 0.15), var(--shadow-card);
}
.proto-card-highlight:hover {
  border-color: rgba(124, 108, 240, 0.55);
  box-shadow: 0 4px 28px rgba(124, 108, 240, 0.22);
}

.proto-card-badge {
  width: 40px;
  height: 40px;
  border-radius: var(--radius);
  background: var(--gradient-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}

.proto-card-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex: 1;
}

.proto-card-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.proto-card-desc {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.proto-card-features {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.proto-card-features li {
  font-size: 0.82rem;
  color: var(--text-muted);
  padding-left: 1rem;
  position: relative;
}
.proto-card-features li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--success);
  font-size: 0.72rem;
}

.back-note {
  padding: 1rem;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
}

code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
}
</style>
