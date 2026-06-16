# Módulo Web

SPA Vue 3 para reservas, monitoramento de máquinas e administração do laboratório.

**Stack:** Vue 3 · TypeScript · Vite · Pinia · Vue Router · Axios · Chart.js

---

## Papel

Interface entre **usuários** (alunos/pesquisadores) e **administradores** do lab. Consome a API REST em `/api/v1` com Bearer token; bootstrap público via `GET /api/config` (fuso, calendário, flags de alocação).

| Público | O que faz no front |
|---------|-------------------|
| **User** | Gantt, reservas, SSH, minhas alocações, estatísticas de sessão, parque de máquinas |
| **Admin** | Tudo acima + CRUD usuários/máquinas/alocações, processos/sessões no detalhe da máquina, manutenção, políticas |

---

## Como rodar

```bash
cd apps/web
npm install
echo "VITE_API_URL=http://localhost:3333" > .env
npm run dev
```

Requisito: **Node.js 22.x** e API rodando. Guia de seed: [`README.md`](README.md).

Testes utilitários: `node src/utils/datetime.spec.mjs`, `ssh.spec.mjs`, `notificationMessage.spec.mjs`.

---

## Rotas (`src/router/index.ts`)

| Rota | View | Auth | Descrição |
|------|------|------|-----------|
| `/login` | `LoginView` | Pública | Login e-mail/senha |
| `/` | `HomeView` | User | Calendário Gantt + nova reserva |
| `/my-allocations` | `MyAllocationsView` | User | Histórico e ações sobre reservas |
| `/machines` | `MachinesView` | User | Parque agrupado + busca |
| `/machines/:id` | `MachineDetailView` | User | Specs, telemetria ao vivo, gráfico 24 h, partições, reservar, conectar |
| `/profile` | `ProfileView` | User | Perfil + chave SSH ed25519 |
| `/admin` | `AdminDashboardView` | Admin | Dashboard |
| `/admin/users` | `AdminUsersView` | Admin | CRUD usuários |
| `/admin/machines` | `AdminMachinesView` | Admin | CRUD máquinas |
| `/admin/machines/:id` | → `MachineDetailView?from=admin` | Admin | Mesmo detalhe com contexto admin |
| `/admin/machines/:id/edit` | `AdminMachineEditView` | Admin | Specs, discos (política), telemetria custom, SSH |
| `/admin/allocations` | `AdminAllocationsView` | Admin | Todas as alocações + ações |
| `/admin/maintenance` | `AdminMaintenanceView` | Admin | Abas: telemetria, políticas, retenção, grupos |
| `/admin/lab-telemetry` | redirect → `?tab=telemetria` | Admin | Compatibilidade de bookmark (view antiga removida) |

Layout: `AppLayout.vue` (navbar, notificações, links admin).

---

## Stores (Pinia)

| Store | Responsabilidade |
|-------|------------------|
| `auth` | Login, token, `/me`, roles |
| `allocations` | CRUD reservas, minhas alocações |
| `machines` | Listagem, detalhe, stream de telemetria, gráfico 24 h (`chartHistory`) |
| `users` | Lista de usuários (admin) |
| `notifications` | Inbox, marcar lida |
| `labConfig` | Cache de `GET /api/config`, presets de telemetria |
| `machineGroups` | Grupos de máquinas (admin) |
| `systemMaintenance` | Prune e jobs de manutenção |

---

## Fluxo do usuário

### Reservas (`HomeView`, `CalendarGanttScroll`, `ReservationFormFields`)

1. Escolhe máquina(s) no Gantt ou formulário.
2. Informa início/fim no **relógio de parede do lab** (`LabWallClockDateInput` / `LabWallClockTimeInput`).
3. Se a máquina tem vários volumes user: escolhe **disco de home** (`listAllocatableDiskMountpoints`).
4. Validações client-side espelham a API: ordem do período, passado, duração mínima, limite futuro, conflito de grace.
5. Submete → `pending` ou `approved` conforme política do lab.

### Minhas alocações (`ProfileMyAllocationsTab`, `MyAllocationDetailPanel`)

- **Lifecycle** derivado no front via `effectiveLifecycleStatus` + relógio sincronizado (`serverNowMs`).
- Ações: cancelar, finalizar, estender (`ExtendAllocationOverlay`), ocultar do histórico.
- **Conectar:** `ProfileAllocationConnectModal` — IP, porta, `systemUsername`, comando SSH/SFTP (`utils/ssh.ts`).
- **Estatísticas:** `AllocationUsageStatsModal` — TWA, picos, gráficos (`AllocationSummaryChart`) quando existe `allocation.metric`.

### Parque (`MachinesView`, `MachineParkCard`, `MachineParkInfoModal`)

- Cards com RAM, GPU+VRAM, **disco total** (`displayTotalDiskGb`), status efetivo.
- Modal: specs completas, partições ordenadas por tamanho, livre/total por volume.

### Detalhe da máquina (`MachineDetailView`)

Visível para **qualquer usuário autenticado** em `/machines/:id` (admin usa a mesma view, com `?from=admin`):

| Seção | Usuário | Admin |
|-------|---------|-------|
| Header (CPU, GPU, RAM, disco, IP) | sim | sim |
| Barras ao vivo (CPU/GPU/RAM/rede/temp) | sim | sim |
| Gráfico 24 h (`MachineChartHistoryChart`) | sim | sim |
| Partições com uso ao vivo | sim | sim |
| Reservar / Conectar SSH | sim | sim |
| Tabela de **processos** | — | sim |
| Collapsible **Usuários** (sessões ativas) | — | sim |
| Botão preset telemetria (`MachineTelemetryPanel`) | — | sim |
| Editar máquina | — | sim |

Fontes: barras e partições via `useTelemetryPlayback` → `GET …/telemetry/stream`; gráfico via `useMachineChartHistory` → `GET …/telemetry` (`chartHistory`). Rotas abertas a usuário autenticado (não exigem `admin`).

---

Abas via `AdminMachine*Tab`:

| Aba | Editável | Somente leitura / agente |
|-----|----------|---------------------------|
| **Hardware** | CPU, GPU, RAM, VRAM, **disco total**, IP local, IP alternativo | Valores vazios serão preenchidos no próximo `sync-specs` |
| **Discos** | `mainDisk`, `allocatable`, `onlyMainDisk` | `totalGb`, `freeGb`, `%` — atualizados por sync/telemetria |
| **Telemetria** | Preset custom (intervalo, batch, toggles, processos) | Presets fast/eco globais em manutenção |
| **Usuários provisionados** | Override `shell` / `sftp` / `auto` | Inventário reconciliado no heartbeat |
| **SSH** | Porta, IP alternativo para conexão | Tentativas de login (auditoria) |

**Regra de specs:** admin preenche → agente **não sobrescreve** no boot. Admin **limpa** campo → agente repreenche no próximo sync.

### Extras no detalhe — só admin

Além das seções da tabela acima: `MachineTelemetryPanel` (preset custom), `MachineLiveProcessSection`, collapsible **Usuários** (`activeUsers`).

Playback: `useTelemetryPlayback` — polling a cada **3 s** em `/telemetry/stream`, diff de lotes (`telemetryBatchDiff`), reprodução suave entre timestamps. `liveData` = mais recente entre playback e `machine.latestTelemetry` (parque, refresh 30 s).

Gráfico 24 h: `useMachineChartHistory` — polling em `/telemetry` (`chartHistory`); atualiza em ocioso **e** alocação.

### Manutenção (`AdminMaintenanceView`)

Abas inline (`.filter-tabs` — componente `AdminTabBar` foi removido; UI unificada aqui):

- **Telemetria:** presets fast/eco globais (`AdminMaintenanceTelemetryTab`) — substitui a antiga `AdminLabTelemetryView`.
- **Políticas:** aprovação, grace, SFTP, nomes no Gantt.
- **Retenção / grupos / execução:** prune e jobs.

### Alocações admin (`AdminAllocationsView`)

- Filtros por status e sub-estado lifecycle.
- Aprovar, negar, cancelar, editar período (overlay Gantt), gerar resumo, excluir definitivamente.

---

## Specs e discos no front

Utilitário central: `src/utils/machineDisks.ts`.

| Função | Uso |
|--------|-----|
| `displayTotalDiskGb` | Spec `totalDiskGb` **ou** soma de `totalGb` das partições |
| `mergeDiskPartitionsWithTelemetry` | Atualiza livre/total/% na UI ao vivo |
| `diskUsedPct` | Percentual 0–100 (sanitiza arredondamento EFI) |
| `listAllocatableDiskMountpoints` | Picker de disco na reserva |
| `formatPartitionFreeTotal` | Cards do parque: `livre / total` |

Wire GB×10 fica só na API/DB; HTTP e inputs admin usam **GB decimal** (1 casa).

---

## Processos (admin)

`MachineLiveProcessSection` + `ProcessTelemetryTable`:

- **Captura no agente:** `processCaptureConfig.userScope` em preset/custom. Com **`session`**, o agente só inclui processos de usuários `lab.*` conectados; sem sessão lab., nada é enviado (`processes` omitido) — a tabela fica vazia mesmo com captura ligada. Use **`all`** para monitorar o host ocioso.
- Filtro **Usuário** (só exibição): `Todos` | `Usuário lab.` (`username` começa com `lab.`) | `Sistema` (demais contas).
- Ordenação por métrica (CPU, RAM, VRAM, GPU, I/O).
- `cpuPercent` exibido como % do **host** (agente já normaliza psutil ÷ CPUs lógicas).

Helpers: `src/utils/processTelemetry.ts` (`filterProcessesByUserScope`, `sortProcessSnapshots`).

---

## Horários e fuso

| Camada | Formato |
|--------|---------|
| API / banco | **UTC** (`…Z`) |
| Inputs | Relógio de parede no fuso do lab (`labConfig.timezone`) |
| Exibição | `formatLabDateTime` / `fmtAllocationDateTime` |

Utilitário: `src/utils/datetime.ts` — `wallClockToUtcIso`, validações de período em `allocationPeriodValidation.ts`.

Sincronização de relógio: `src/services/timeSync.ts` — `startTimeSync()` + `serverNowMs()` (offset via `GET /api/time`).

---

## Telemetria no front

### Três caminhos de dados

| Caminho | Endpoint / store | Quando | UI |
|---------|-------------------|--------|-----|
| **Ao vivo** | `GET /machines/:id/telemetry/stream` via `useTelemetryPlayback` | Usuário autenticado no detalhe da máquina | Barras, discos (partições) |
| **Parque / fallback** | `GET /machines` → `latestTelemetry` | Listagem e refresh 30 s | Cards do dashboard admin |
| **Gráfico 24 h** | `GET /machines/:id/telemetry` → `chartHistory` via `useMachineChartHistory` | Usuário autenticado (seção gráficos) | `MachineChartHistoryChart` |
| **Resumo de sessão** | `GET /allocations/:id/summary` | Após admin gerar resumo | `AllocationUsageStatsModal` |

Durante **alocação ativa**, barras/partições usam o buffer runtime (stream). O gráfico 24 h agrega TWA @ 15 min no `chartTelemetryBuffer`. **Processos** e **sessões ativas** só aparecem para admin. Escalares da sessão no resumo vêm do chart buffer; SQLite guarda só snapshots com `processes`.

**Memória (ocioso):** ao vivo = ring ~15 amostras ricas em `telemetryBuffer`; gráfico = janela pending ≤15 + **~96 pts @ 15 min** materializados (~**81–116 KiB**/máquina conforme preset). Ver [`apps/api/MODULE.md`](../../api/MODULE.md#retenção-e-buffers).

| Arquivo | Papel |
|---------|--------|
| `composables/useTelemetryPlayback.ts` | Poll stream 3 s; playback; `latestProcesses` |
| `composables/useMachineChartHistory.ts` | Poll chartHistory; `chartSeries` 24 h |
| `utils/telemetryBatchDiff.ts` | Diff de lotes, ordenação por timestamp |
| `utils/processTelemetry.ts` | Filtro lab/sistema, sort da tabela |
| `telemetryPresets.ts` | Constantes, validação de intervalo/batch/processos |
| `telemetryChartConfig.ts` | Cores e abas de gráfico |
| `buildAllocationChartTabs.ts` | Séries para resumo de alocação |
| `allocationMetricFormat.ts` | Formatação TWA para modal de estatísticas |

Métricas ausentes na amostra (`null`) → UI mostra `—`, não zero.

---

## Componentes principais

| Área | Componentes |
|------|-------------|
| Reservas | `CalendarGanttScroll`, `ReservationFormFields`, `ReservationMachinePicker`, `ExtendAllocationOverlay` |
| Máquinas | `MachineLiveSections`, `MachineLiveProcessSection`, `MachineTelemetryPanel`, `AdminMachine*Tab` |
| Relatórios | `AllocationUsageStatsModal`, `AllocationSummaryChart` |
| SSH | `ProfileAllocationConnectModal` |
| Notificações | `NotificationsPanel` |
| Admin manutenção | `AdminMaintenance*Tab` |
| Datetime | `LabWallClockDateInput`, `LabWallClockTimeInput` |

---

## Notificações (inbox)

A API gera eventos; o front lista e marca como lidas (`stores/notifications.ts`). Ver tabelas em [`apps/api/MODULE.md`](../api/MODULE.md#notificações-notification_service).

---

## API e interceptors

- `src/services/api.ts` — Axios, `VITE_API_URL`, header `Authorization`.
- Login: `{ value, user }` (token em `value`).
- Roles: `user` | `admin`.

---

## Estilos

Tema escuro em `src/assets/main.css` (`--bg-*`, `--text-*`, `--border`). Listagens admin compartilham `allocation-list.css`.

---

## Mudanças recentes (jun/2026)

| Mudança | Impacto no front |
|---------|------------------|
| Specs merge só quando vazias | Admin edita hardware; placeholders *Aguardando sync*; limpar reabilita sync |
| `totalDiskGb` como coluna de spec | Label **Disco** no header; fallback soma partições |
| Capacidade de partição read-only no admin | `AdminMachineDisksTab` só edita política |
| IP local vs alternativo | Labels distintas; `publicIpAddress` só admin |
| Telemetria nullable | Gráficos e painéis usam `—` para métrica desligada |
| Telemetria lab → manutenção | `/admin/lab-telemetry` redirect; removidos `AdminLabTelemetryView`, `AdminTabBar` |
| Filtro de processos por tipo de usuário | Toolbar em `MachineLiveProcessSection` |
| Seção Usuários no detalhe admin | Sessões ativas; removido bloco debug da API |
| `idleHistory` → `chartHistory` | `useMachineChartHistory`, `MachineChartHistoryChart`; gráfico 24 h também durante alocação |
| Remoção fase `prepare` | Sem SFTP pré-alocação; conta só a partir de `startTime` (API + agente) |
| Telemetria no detalhe da máquina | Usuários autenticados veem barras, gráfico 24 h e partições; processos/sessões só admin |

---

## Referências

- Contratos e endpoints: [`apps/api/MODULE.md`](../api/MODULE.md)
- Agente, sync-specs e fases: [`apps/agent/MODULE.md`](../agent/MODULE.md)
- Visão geral do sistema: [`README.md`](../../README.md)
