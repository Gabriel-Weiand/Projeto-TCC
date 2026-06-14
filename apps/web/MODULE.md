# Módulo Web

SPA Vue 3 para reservas, monitoramento de máquinas e administração do laboratório.

**Stack:** Vue 3 · TypeScript · Vite · Pinia · Vue Router · Axios · Chart.js

---

## Papel

Interface entre **usuários** (alunos/pesquisadores) e **administradores** do lab. Consome a API REST em `/api/v1` com Bearer token; bootstrap público via `GET /api/config` (fuso, calendário, flags de alocação).

| Público | O que faz no front |
|---------|-------------------|
| **User** | Gantt, reservas, SSH, minhas alocações, estatísticas de sessão, parque de máquinas |
| **Admin** | Tudo acima + CRUD usuários/máquinas/alocações, telemetria ao vivo, manutenção, políticas |

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
| `/machines/:id` | `MachineDetailView` | User | Specs, reservar, conectar; **admin** vê seções ao vivo |
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
| `machines` | Listagem, detalhe, stream de telemetria, idle history |
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

### Detalhe da máquina — usuário (`MachineDetailView`)

- Header: CPU, GPU, RAM, VRAM, **Disco**, **IP local** (placeholder *Aguardando sync* se vazio).
- Disco total: spec `totalDiskGb` ou fallback soma de partições.
- Botão reservar / conectar conforme alocação própria ativa.

---

## Fluxo do administrador

### Edição de máquina (`AdminMachineEditView`)

Abas via `AdminMachine*Tab`:

| Aba | Editável | Somente leitura / agente |
|-----|----------|---------------------------|
| **Hardware** | CPU, GPU, RAM, VRAM, **disco total**, IP local, IP alternativo | Valores vazios serão preenchidos no próximo `sync-specs` |
| **Discos** | `mainDisk`, `allocatable`, `onlyMainDisk` | `totalGb`, `freeGb`, `%` — atualizados por sync/telemetria |
| **Telemetria** | Preset custom (intervalo, batch, toggles, processos) | Presets fast/eco globais em manutenção |
| **Usuários provisionados** | Override `shell` / `sftp` / `auto` | Inventário reconciliado no heartbeat |
| **SSH** | Porta, IP alternativo para conexão | Tentativas de login (auditoria) |

**Regra de specs:** admin preenche → agente **não sobrescreve** no boot. Admin **limpa** campo → agente repreenche no próximo sync.

### Detalhe ao vivo — admin (`MachineDetailView` + `MachineLiveSections`)

Visível para `role === 'admin'` (ou discos para todos quando existem partições):

| Seção | Componente | Fonte de dados |
|-------|------------|----------------|
| Telemetria preset | `MachineTelemetryPanel` | PUT máquina (preset/custom) |
| **Barras ao vivo** (CPU/GPU/RAM/rede/temp) | `MachineLiveSections` | `useTelemetryPlayback` → `GET …/telemetry/stream` (`telemetryBuffer`) |
| **Gráfico 24 h ocioso** | `MachineIdleHistoryChart` | `GET …/telemetry` → `idleHistory.chartSeries` (`idleTelemetryBuffer`; congela em alocação) |
| **Partições** | `MachineLiveSections` | Spec da máquina + `liveData.disksInfo` do stream |
| **Processos** | `MachineLiveProcessSection` | Último lote com `processes` no stream (não vem do buffer 24 h) |
| **Usuários** | Collapsible | `activeUsers` na amostra realtime + heartbeat |

Playback: `useTelemetryPlayback` — polling a cada **3 s** em `/telemetry/stream`, diff de lotes (`telemetryBatchDiff`), reprodução suave entre timestamps. `liveData` = mais recente entre playback e `machine.latestTelemetry` (parque, refresh 30 s).

Histórico ocioso: `useMachineIdleHistory` — polling a cada **30 s** em `/telemetry` (`idleHistory`); só cresce com máquina **sem** alocação ativa na API.

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
| **Ao vivo** | `GET /machines/:id/telemetry/stream` via `useTelemetryPlayback` | Admin no detalhe da máquina | Barras, discos, processos, usuários ativos |
| **Parque / fallback** | `GET /machines` → `latestTelemetry` | Listagem e refresh 30 s | Cards do dashboard admin |
| **Gráfico 24 h ocioso** | `GET /machines/:id/telemetry` → `idleHistory` via `useMachineIdleHistory` | Admin, seção gráficos | `MachineIdleHistoryChart` |
| **Resumo de sessão** | `GET /allocations/:id/summary` | Após admin gerar resumo | `AllocationUsageStatsModal` |

Durante **alocação ativa**, barras/processos/discos usam o buffer runtime (stream). O gráfico 24 h continua exibindo o buffer ocioso **sem novos pontos** até a sessão terminar. Bruto da sessão fica no SQLite até o resumo — o front **não** consulta `history.data` para monitoramento.

**Memória (ocioso):** ao vivo = ring ~15 amostras completas em `telemetryBuffer`; histórico do gráfico = tiers **1 min + 10 min** em `idleTelemetryBuffer` (~198 entradas máx.); série **15 min** = calculada na API, não guardada.

| Arquivo | Papel |
|---------|--------|
| `composables/useTelemetryPlayback.ts` | Poll stream 3 s; playback; `latestProcesses` |
| `composables/useMachineIdleHistory.ts` | Poll idle 30 s; `chartSeries` 24 h |
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

---

## Referências

- Contratos e endpoints: [`apps/api/MODULE.md`](../api/MODULE.md)
- Agente, sync-specs e fases: [`apps/agent/MODULE.md`](../agent/MODULE.md)
- Visão geral do sistema: [`README.md`](../../README.md)
