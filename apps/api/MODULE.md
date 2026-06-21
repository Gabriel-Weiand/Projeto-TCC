# Módulo API

## Papel

A API centraliza regras de negócio, autenticação e persistência. Ela orquestra a comunicação entre frontend e agentes, e consolida as métricas de telemetria em dados de sessão.

## Como rodar

### Pré-requisitos

- Node.js **22.x** (`engines` em `package.json`)
- npm

### Instalação

```bash
# Dentro do monorepo
cd apps/api

npm install

# Configurar ambiente
cp .env.example .env
# Ajuste TZ (fuso do lab) e LAB_* — calendário, limite de reserva, token, crons (ver .env.example)

# Executar as migrations
node ace migration:run

# Banco + seed (perfil dev — fictício completo)
node ace seed:fresh dev
# npm run seed:dev | seed:minimal | seed:lab
# LAB_SEED_PROFILE=lab node ace migration:fresh --seed

# Iniciar servidor
node ace serve --watch
```

### Testes

```bash
cd apps/api
node ace test
```

## Entradas de comunicação

- **Frontend Web**: rotas REST sob `/api/v1` (Bearer de usuário) — auth, usuários, grupos de máquinas, parque, alocações, notificações, auditoria SSH, manutenção em `/system`.
- **Bootstrap público**: `GET /api/alive`, `/api/time`, `/api/config` (sem auth; calendário e `todayIso` no fuso `TZ`).
- **Agentes** (`agentd.py`): `PUT/POST` sob `/api/v1/agent` — `sync-specs`, `heartbeat`, `telemetry` (Bearer do token da máquina, 512 bits).

## Saídas de comunicação

- **Para agentes**: `agentConfig.telemetry` (preset `fast` / `eco` / `custom`), `provisioning` (`accessState`: `full_shell` | `sftp_only`, chave `ssh-ed25519`), `currentAllocation`, `accessControl.shouldBlock` (legado; controle real via shell SSH).
- **Para frontend**: máquinas com telemetria recente (RAM/VRAM em GB decimal), alocações, resumo de sessão, notificações.

## Persistência (migrations atuais)

- `users` com `system_username` e `ssh_public_key` (ed25519).
- `machine_groups` para agrupar o parque (ex.: CUDA vídeo, render).
- `machines` com `token` (bearer do agente, 128 hex), specs (`total_ram_gb`, `total_vram_gb`, **`total_disk_gb`** em wire GB×10), `disks` JSON, `telemetry_preset`, `custom_agent_config`, `host_fingerprint`, `ip_address` (local), `ssh_port`, `public_ip_address` (alternativo, só admin), `only_main_disk`.
- `machine_users` — vínculo usuário ↔ máquina provisionada no SO.
- `allocations` com janela de uso (no seed, reservas ativas de **3 dias a 2 semanas**, uma por máquina exceto GaciS1).
- `telemetries` — snapshots de **processos** durante alocações (wire ×10; removidos após resumo). Escalares TWA vêm do `chartTelemetryBuffer`.
- `allocation_metrics` — TWA, picos por sessão e `chart_series` (série resumida para gráfico).
- `ssh_connection_attempts` — auditoria de login SSH.
- `notifications` — caixa de entrada por usuário.

## Specs, discos e sobreposição admin ↔ agente

Hardware estável e política de volumes seguem regras distintas. Serviços: `#services/machine/specs_merge`, `#services/machine/disk_partitions`.

### Merge de specs no `sync-specs` (`applySyncSpecsIfEmpty`)

O agente envia specs no boot (`PUT /api/v1/agent/sync-specs`). A API **só grava** quando o campo no banco está vazio:

| Campo | Vazio = | Agente preenche se |
|-------|---------|-------------------|
| `cpuModel`, `gpuModel`, `ipAddress`, `hostFingerprint` | `null` ou string em branco | Valor detectado no host |
| `totalRamGb`, `totalVramGb`, `totalDiskGb` | `null` ou wire ≤ 0 | Valor wire GB×10 do agente |

**Admin** edita via `PUT /api/v1/machines/:id` (GB decimal convertido por `normalizeAdminMachineWireFields`). Valor admin **prevalece** sobre sync. **Limpar** campo no admin → próximo sync repreenche.

**Não merge “fill-empty”:** `publicIpAddress` (só admin), `sshPort`, status, preset, `customAgentConfig`, flags de disco.

### Partições (`machines.disks[]`)

| Responsável | Campos |
|-------------|--------|
| **Agente** (sync + telemetria `disksInfo`) | `device`, `mountpoint`, `fstype`, `totalGb`, `freeGb`, `usagePct` |
| **Admin** (`mergeAdminDiskPolicyUpdate`) | `mainDisk`, `allocatable`; `onlyMainDisk` na máquina |
| **Preservado** | `role` (system/user), classificação por mountpoint |

Funções:

- `mergeDiskPartitionsFromAgent` — sync-specs; preserva flags admin.
- `mergeDiskPartitionsFromTelemetry` — última amostra do lote com `disksInfo` no POST telemetry.
- `mergeAdminDiskPolicyUpdate` — PUT máquina; **não** altera capacidade.
- `sanitizeDiskCapacities` / `diskUsagePercent` — evita % negativo (ex.: `/boot/efi`).

`totalDiskGb` na máquina é **capacidade total de disco da spec** (disco principal detectado no boot), **não** soma automática de partições no model — o front pode somar partições como fallback de exibição.

### Resposta HTTP de máquinas

Colunas wire → GB decimal na serialização (`MachinesController.agentGbToApi`): `totalRamGb`, `totalVramGb`, `totalDiskGb`.

## Consolidação de telemetria

- **Média ponderada pelo tempo (TWA):**

$TWA = \frac{\sum (v_i \cdot \Delta t_i)}{T_{total}}$

- **Fallback de GPU:** dados nulos/zerados de GPU são ignorados na consolidação, sem interromper o cálculo das demais métricas.

### Retenção e buffers

A API mantém **dois buffers distintos em RAM** (singleton por processo), além da persistência em SQLite durante alocações.

#### 1. `telemetryBuffer` (`#services/telemetry/buffer`) — tempo real + fila de persistência

| Estrutura | Capacidade | Função |
|-----------|------------|--------|
| `latestState` | 1 amostra / máquina | Snapshot mais recente (`getLatest`) |
| `recentEntries` / `lastBatchByMachine` | até **15** amostras / máquina | Último lote do agente; exposto em `GET …/telemetry/stream` |
| `buffer` (fila) | flush a cada **60 s** ou 1000 registros | Inserts em lote na tabela `telemetries` (**só** amostras com `processes`) |

**Atualizado em todo POST `/agent/telemetry`**, com ou sem alocação ativa:

- **Com alocação** (`Allocation` `approved` na janela): `add(..., persist: só se processes)` → tempo real; fila SQLite **só** snapshots de processos.
- **Sem alocação**: `updateRealtime()` → só tempo real (`allocationId: 0`); **não** grava em `telemetries`.

`recordBatch()` guarda sempre o último lote (≤ 15) para diff/playback no front.

#### 2. `chartTelemetryBuffer` (`#services/telemetry/chart_buffer`) — gráfico 24 h (ocioso ou alocação)

| Estrutura | Capacidade | Função |
|-----------|------------|--------|
| `pendingBucket` (`pendingSamples` + `pendingBucketStartMs`) | amostras do agente na janela **15 min aberta** (≤ ~15 no eco) | acumula na **precisão exata** do POST; descartadas ao fechar o bucket |
| `chartSeries` | **~96** pontos @ **15 min** (24 h rolling) | TWA ao fechar cada janela; **materializado** — não recalculado no GET |

**Recebe amostras em todo POST** (`ingest()`), com ou sem alocação. Só métricas agregáveis (TWA); `processes` / `disksInfo` ficam no `telemetryBuffer` ao vivo.

Perdido ao **reiniciar a API**.

#### Ciclo de vida

```
POST agente, para cada amostra do lote:
  → chartTelemetryBuffer.ingest()
  → append em pendingBucket (campos agregáveis @ 15 min)
  → se timestamp cruza fim do bucket 15 min corrente:
       TWA(pendingBucket) → merge em chartSeries
       pendingBucket := []
  → purge chartSeries com timestamp < now − 24 h

GET …/telemetry:
  → chartHistory.chartSeries = chartSeries fechados + preview TWA da janela aberta
  → chartHistory.points = alias de chartSeries (compat.)
```

#### RAM — 1 máquina ociosa, 24 h em regime estável

Eco: **60 s**, batch **15** → 96 fechamentos de bucket/dia; no pico, pending + chart + ring realtime.

| Preset | Amostra agente (JSON) | Ponto @ 15 min (JSON) | `telemetryBuffer` (~31) | chart pending (≤15) | chart series (~96) | **Total** |
|--------|----------------------:|----------------------:|------------------------:|-------------------:|-----------------:|----------:|
| **Eco atual** | ~638 B | ~177 B | ~35 KiB | ~17 KiB | ~30 KiB | **~81 KiB** |
| **Eco full − proc**¹ | ~776 B | ~315 B | ~42 KiB | ~20 KiB | ~53 KiB | **~116 KiB** |

¹ Mesmos intervalos eco; `telemetrySet` = fast completo **exceto** `processCapture: false` (gpu, rede, temp, users, disco ligados).

Totais com overhead V8 ≈ ×1,8 sobre JSON serializado. Parque com *N* máquinas ociosas: multiplicar **Total** por *N* (singleton API).

**Melhoria opcional (fase futura):** pending só campos TWA (~177 B) em vez da amostra rica — economia extra ~12 KiB/máq. no eco.

Números ao vivo vêm de **`telemetryBuffer.getLatest()`**; fallback `chartTelemetryBuffer.getLatestEntry()` se não houve POST recente.

#### Roteamento no `POST /agent/telemetry`

```
Para cada amostra do lote:
  sempre → chartTelemetryBuffer.ingest()   # gráfico 24 h @ 15 min (ocioso ou alocação)
  se alocação approved na janela:
    telemetryBuffer.add(..., persist: só se processes.length > 0)
  senão → telemetryBuffer.updateRealtime()

Sempre: telemetryBuffer.recordBatch(lote completo)
```

#### O que usar em cada cenário (admin / front)

| Necessidade | Fonte durante alocação | Fonte com máquina ociosa |
|-------------|--------------------------|---------------------------|
| Barras CPU/GPU/RAM, discos ao vivo | `telemetryBuffer` (`/telemetry/stream`, `latestTelemetry`) | idem |
| Tabela de **processos** | último lote em `telemetryBuffer` (campo `processes` da amostra) | idem; vazio se `userScope: session` e nenhum `lab.*` em sessão |
| Sessões **activeUsers** | amostra realtime (buffer) + heartbeat | idem |
| Gráfico **24 h** | `chartTelemetryBuffer` — ativo em ocioso **e** alocação (mesma série @ 15 min) | atualizado a cada POST |
| Persistência **processos** (sessão) | tabela `telemetries` (flush 60 s) | N/A |
| Gráfico pós-sessão (usuário/admin) | `allocation_metrics.chart_series` após resumo | N/A |

> **Importante:** durante alocação o monitoramento ao vivo **não** lê `telemetries` no SQLite — usa só o buffer runtime. O banco serve para resumo TWA, auditoria e purge pós-`POST /allocations/:id/summary`.

| Contexto | Onde fica | Resolução | Retenção |
|----------|-----------|-----------|----------|
| Máquina (gráfico 24 h) | Buffer em memória (`chart_buffer`) | **15 min** (~96 pts + preview) | 24 h; perdido ao reiniciar a API |
| **Alocação ativa** | `telemetries` (DB) — **só processos** + espelho realtime | Intervalo do agente | Até gerar resumo |
| **Após resumo** | `allocation_metrics.chart_series` | Buckets @ 15 min do chart buffer ou adaptativos (fallback DB) | Até prune da alocação |
| **Gráfico 24 h (UI)** | `chartHistory.chartSeries` via GET `/machines/:id/telemetry` | **15 min/ponto** fixo (~96 pts / 24 h) | `chartTelemetryBuffer` |

- Intervalo de captura **< 60 s** (ocioso): amostras agregadas em buckets de 1 min (TWA).
- Intervalo **≥ 60 s** (ocioso): pontos guardados como capturados.
- **Gráfico de resumo:** preferência `chartSeriesFromChartBuffer` (@ 15 min do `chartTelemetryBuffer`); fallback `buildAllocationChartSeries` no DB (buckets adaptativos via `resolveChartBucketMs`, ≤ **100 pontos**).
- Buckets sem amostras são **omitidos** no fallback DB (evita pontos 0% espúrios).
- Intervalo máximo de captura (custom/presets): **300 s (5 min)**.
- `POST /allocations/:id/summary` — TWA/chart do chart buffer (ou DB legado); `processSummary` do SQLite; **remove** linhas em `telemetries`.

## Observações

- `system_username` deve ser estável/imutável por regra de negócio (a constraint explícita não está no schema).
- Autenticação do agente: apenas `Authorization: Bearer <token>` (512 bits).

## Notificações

### Arquivos

| Arquivo | Papel |
|---------|--------|
| `app/services/notification/notification_service.ts` | **Envio** — cria registros na tabela `notifications` (títulos, mensagens, deduplicação) |
| `app/services/notification/inbox_service.ts` | **Caixa de entrada** — listar (até 50), marcar lida, excluir (rotas `GET/PATCH/DELETE /notifications`) |
| `app/controllers/notifications_controller.ts` | HTTP da inbox; autorização via `NotificationPolicy` (somente dono) |
| `start/scheduler.ts` | Cron operacional (lembretes T-10/T-5/T-0, agente offline) |
| `app/services/agent/heartbeat_service.ts` | Flood SSH e lembrete de chave no início da sessão |

Persistência: model `Notification` (`userId`, `title`, `message`, `isRead`, `readAt`, `createdAt`). Cada notificação pertence a **um** usuário; admins recebem cópias individuais via `notifyAllAdmins`.

### Deduplicação

- **Alocação:** marcador `[alloc#<id>#]` no corpo da mensagem — lembretes agendados (T-10, SSH T-5/T-0) não repetem o mesmo título para a mesma alocação.
- **Máquina (admin):** marcador `[machine#<id>#]` + cooldown configurável — evita flood em “Possível flood SSH” e “Agente offline”.

Variáveis `LAB_NOTIF_*`: ver `.env.example` e tabela de limites mais abaixo neste doc.

### Catálogo — usuário (`role: user` e dono da alocação)

| Título | Gatilho | Origem |
|--------|---------|--------|
| **Reserva aprovada** | `pending` → `approved` | `notifyAllocationStatusChange` ← `AllocationService.update` / `softDelete` |
| **Reserva negada** | status → `denied` | idem |
| **Reserva cancelada** | status → `cancelled` (reserva já aprovada ou outro fluxo; **não** quando o autor cancela uma `pending`) | `notifyAllocationStatusChange` ← `AllocationService.update` / `softDelete` |
| **Reserva cancelada (manutenção)** | máquina em `maintenance` ou descomissionamento cancela `approved`/`pending` | `cancelAllocationsForMaintenance` ← `MachineService.update` / `decommission` |
| **Reserva em breve** | início da reserva em até `LAB_NOTIF_UPCOMING_MINUTES` (padrão 10 min) | scheduler → `runScheduledAllocationReminders` |
| **Chave SSH — reserva em 5 min** | início em até `LAB_NOTIF_SSH_KEY_MINUTES` (padrão 5 min), usuário sem `sshPublicKey` | scheduler → `runScheduledAllocationReminders` |
| **Chave SSH — reserva iniciada** | sessão ativa sem chave SSH | scheduler **ou** heartbeat da alocação corrente → `maybeNotifyMissingSshKeyAtSessionStart` |
| **Sessão encerrada** | auto-finalize após janela SFTP (`finished` pelo scheduler) | `summarizer.autoFinalizeExpired` → `notifyAllocationAutoFinished` |
| **Sessão encerrada** | usuário chama `POST /allocations/:id/finish` | `AllocationService.finishAllocation` → `notifyAllocationFinishedByUser` (mesmo título, mensagem “Você finalizou…”) |
| **Resumo da sessão disponível** | admin gera métricas com `POST /allocations/:id/summary` | `AllocationService.summarizeSession` → `notifySessionSummaryReady` |
| **Cadastre sua chave SSH** | criação de conta (`POST /users` ou registro admin) | `UserService.createUser` → `notifySshKeyRequired` |

### Catálogo — admin (todos os usuários com `role: admin`)

| Título | Gatilho | Origem |
|--------|---------|--------|
| **Nova reserva pendente** | nova alocação com `status: pending` | `AllocationService.createAllocation` → `notifyAdminsPendingAllocation` |
| **Possível flood SSH** | heartbeat envia `sshAttempts` e há ≥ `LAB_NOTIF_SSH_FLOOD_THRESHOLD` falhas na janela (`LAB_NOTIF_SSH_FLOOD_WINDOW_MINUTES`); cooldown `LAB_NOTIF_SSH_FLOOD_COOLDOWN_HOURS` por máquina | `heartbeat_service` → `checkSshFailureFlood` |
| **Agente offline** | scheduler: máquina `available`/`occupied` sem `lastSeenAt` ou heartbeat &gt; `LAB_NOTIF_AGENT_OFFLINE_MINUTES`; cooldown `LAB_NOTIF_AGENT_OFFLINE_COOLDOWN_HOURS` por máquina | scheduler → `notifyOfflineAgents` |

Quando uma solicitação **deixa de ser** `pending` (`approved`, `denied` ou `cancelled` pelo autor), o alerta **Nova reserva pendente** é **removido** da inbox de todos os admins (`clearPendingAllocationAdminNotifications`). Não há notificação admin de desfecho (`pending` → `denied`/`cancelled`).

Flood SSH **não** roda no endpoint de telemetria — só quando o agente envia tentativas no heartbeat.

**Agente offline:** job no mesmo cron do auto-finalize (padrão 5 min); cooldown longo (padrão 24 h) limita a um lembrete por máquina problemática por dia.

### Manutenção de máquina

`PUT /machines/:id` com `status: maintenance` (ou fluxo de descomissionamento) cancela **todas** as alocações `approved`/`pending` da máquina e envia **Reserva cancelada (manutenção)** a cada usuário afetado. Resposta da API inclui `cancelledAllocations` quando &gt; 0.

### API da inbox (consumo no front)

| Método | Rota | Quem |
|--------|------|------|
| `GET` | `/api/v1/notifications` | usuário logado — últimas 50 próprias |
| `PATCH` | `/api/v1/notifications/:id/read` | dono — `{ "isRead": true/false }` |
| `DELETE` | `/api/v1/notifications/:id` | dono — remove da inbox (hard delete) |

Limpeza em massa (admin): `DELETE /api/v1/system/prune/notifications` ou rotina `POST /system/maintenance/run` — não há exclusão pontual admin por `:id`.

---

## Arquitetura interna (API)

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API (AdonisJS)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   Controllers   │  │   Middleware    │  │        Services             │  │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────────────────┤  │
│  │ AgentController │  │ AuthMiddleware  │  │ MachineCache (TTL: 5min)    │  │
│  │ AuthController  │  │ MachineAuth     │  │ TelemetryBuffer (batch)     │  │
│  │ UsersController │  │ IsAdmin         │  └─────────────────────────────┘  │
│  │ MachinesCtrl    │  │ ForceJSON       │                                   │
│  │ AllocationsCtrl │  └─────────────────┘  ┌─────────────────────────────┐  │
│  │ SystemCtrl      │                       │        Models               │  │
│  │ LabSettingsCtrl │                       │                             │  │
│  └─────────────────┘  ┌─────────────────┐  ├─────────────────────────────┤  │
│                       │   Validators    │  │ User, Machine, Allocation   │  │
│                       ├─────────────────┤  │ Telemetry, AllocationMetric │  │
│                       │ VineJS Schemas  │  │ AccessToken                 │  │
│                       └─────────────────┘  └─────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Diagrama de Entidade-Relacionamento

```
USERS (1)───<(N) ALLOCATIONS (N)>───(1) MACHINES (N)>───(1) MACHINE_GROUPS
  │                    │                        │
  │ (1)                │ (1)                    │ (1)
  └──<(N) ACCESS_TOKENS │                        └──<(N) SSH_CONNECTION_ATTEMPTS
  └──<(N) NOTIFICATIONS │
  └──<(N) MACHINE_USERS (N)>──(1) MACHINES        ALLOCATIONS (1)──<(N) TELEMETRIES
                                                  ALLOCATIONS (1)──(1) ALLOCATION_METRICS

┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│        USERS         │   │        MACHINES          │   │      MACHINE_GROUPS      │
├──────────────────────┤   ├──────────────────────────┤   ├──────────────────────────┤
│ id (PK)              │   │ id (PK)                  │   │ id (PK)                  │
│ full_name / email(UQ)│   │ machine_group_id (FK)    │   │ title                    │
│ system_username (UQ) │   │ name / description       │   │ description              │
│ password (scrypt)    │   │ system_username          │   │ created_at / updated_at  │
│ role (enum)          │   │ token (128 hex / 512 bit)│   └──────────────────────────┘
│ ssh_public_key       │   │ host_fingerprint         │
│ created_at/updated_at│   │ cpu_model / gpu_model    │
└──────────────────────┘   │ total_ram_gb  (wire ×10) │
                           │ total_vram_gb (wire ×10) │
┌──────────────────────┐   │ total_disk_gb (wire ×10) │
│    ACCESS_TOKENS     │   │ disks (JSON)             │
├──────────────────────┤   │ ip_address / ssh_port    │
│ id (PK)              │   │ public_ip_address        │
│ tokenable_id (FK)    │   │ status (enum)            │
│ type / name          │   │ telemetry_preset (enum)  │
│ hash / abilities     │   │ custom_agent_config(JSON)│
│ last_used_at         │   │ current_sessions (JSON)  │
│ expires_at           │   │ only_main_disk           │
└──────────────────────┘   │ last_seen_at             │
                           │ token_rotated_at         │
┌──────────────────────┐   │ created_at / updated_at  │
│    MACHINE_USERS     │   └──────────────────────────┘
├──────────────────────┤
│ id (PK)              │   ┌──────────────────────────┐
│ user_id (FK)         │   │       ALLOCATIONS        │
│ machine_id (FK)      │   ├──────────────────────────┤
│ access_type (enum)   │   │ id (PK)                  │
│ last_active_at       │   │ user_id (FK, SET NULL)   │
│ created_at/updated_at│   │ machine_id (FK, CASCADE) │
└──────────────────────┘   │ start_time / end_time    │
                           │ reason                   │
┌──────────────────────┐   │ status (enum)            │
│     NOTIFICATIONS    │   │ user_hidden              │
├──────────────────────┤   │ home_mountpoint          │
│ id (PK)              │   │ created_at / updated_at  │
│ user_id (FK)         │   └────────────┬─────────────┘
│ title / message      │                │
│ is_read / read_at    │      ┌─────────┴──────────┐
│ created_at           │      ▼                    ▼
└──────────────────────┘  ┌──────────────────┐  ┌──────────────────────┐
                          │   TELEMETRIES    │  │  ALLOCATION_METRICS  │
┌──────────────────────┐  ├──────────────────┤  ├──────────────────────┤
│SSH_CONNECTION_ATTEMPTS│ │ id (PK)          │  │ id (PK)              │
├──────────────────────┤  │ allocation_id(FK)│  │ allocation_id (FK,UQ)│
│ id (PK)              │  │ timestamp        │  │ avg/max_cpu_usage     │
│ machine_id (FK)      │  │ cpu_usage        │  │ avg/max_cpu_temp      │
│ source_ip            │  │ cpu_temp/freq    │  │ avg/max_gpu_usage     │
│ target_username      │  │ gpu_usage/temp   │  │ avg/max_gpu_temp      │
│ status (enum)        │  │ gpu_power_watts  │  │ avg/max_gpu_power     │
│ auth_method         │  │ vram_*_gb        │  │ avg/max_vram_*_gb     │
│ client_fingerprint   │  │ ram_*_gb         │  │ avg/max_ram_used_gb   │
│ created_at           │  │ swap_*_gb        │  │ avg/max_swap_used_gb  │
└──────────────────────┘  │ disks_info (JSON)│  │ avg/max_disk_*_mbps   │
                          │ disk_*_mbps      │  │ avg/max_*_mbps (rede) │
  Convenção wire ×10:     │ download/upload  │  │ avg/max_mobo_temp     │
  inteiros = valor real   │ mobo_temperature │  │ session_duration_min  │
  ×10 (155 = 15,5).       │ active_users(JSON)│ │ chart_bucket_minutes  │
  TELEMETRIES guarda só   │ processes (JSON) │  │ chart_series (JSON)   │
  amostras COM processos  └──────────────────┘  │ process_summary (JSON)│
  durante a alocação.                           │ created_at           │
                                                └──────────────────────┘
```

---

## Tecnologias Utilizadas

| Tecnologia          | Versão     | Propósito                                  |
| ------------------- | ---------- | ------------------------------------------ |
| **Node.js**         | 22.x       | Runtime JavaScript (`engines` + `.nvmrc`)  |
| **AdonisJS**        | 6.18+      | Framework web full-stack (`@adonisjs/core`)|
| **TypeScript**      | 5.8        | Tipagem estática                           |
| **Lucid ORM**       | 21.x       | Mapeamento objeto-relacional               |
| **VineJS**          | 3.x        | Validação de dados                         |
| **better-sqlite3**  | 12.x       | Driver SQLite (WAL Mode habilitado)        |
| **Luxon**           | 3.x        | Datas/fuso (UTC ↔ relógio do lab)          |
| **node-cron**       | 4.x        | Agendador (lembretes, retenção, resumo)    |
| **Japa**            | 4.x        | Testes funcionais (`node ace test`)        |

Demais dependências (`@adonisjs/auth`, `@adonisjs/bouncer`, `@adonisjs/cors`): ver `apps/api/package.json`.

---

## Segurança

### Criptografia de Senhas

As senhas dos usuários **nunca são armazenadas em texto plano** no banco de dados. O sistema utiliza o algoritmo **scrypt** para hash de senhas, um dos mais seguros disponíveis atualmente.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ARMAZENAMENTO SEGURO DE SENHAS                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  📥 CADASTRO/ATUALIZAÇÃO DE SENHA                                       │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  Senha: "minhasenha123"                                            │ │
│  │           │                                                        │ │
│  │           ▼                                                        │ │
│  │  ┌─────────────────┐                                               │ │
│  │  │  Algoritmo      │  • scrypt (padrão AdonisJS)                   │ │
│  │  │  de Hashing     │  • Resistente a ataques de GPU                │ │
│  │  │  (scrypt)       │  • Salt aleatório por senha                   │ │
│  │  └────────┬────────┘                                               │ │
│  │           │                                                        │ │
│  │           ▼                                                        │ │
│  │  Hash: "$scrypt$n=16384,r=8,p=1$salt$hash..."                      │ │
│  │  (armazenado no banco de dados)                                    │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  📤 VERIFICAÇÃO DE LOGIN                                                │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  1. Usuário envia: email + senha em texto plano (via HTTPS)        │ │
│  │  2. API busca o hash armazenado pelo email                         │ │
│  │  3. Aplica o mesmo algoritmo na senha enviada                      │ │
│  │  4. Compara os hashes (timing-safe comparison)                     │ │
│  │  5. Se igual → Login autorizado                                    │ │
│  │     Se diferente → Credenciais inválidas                           │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ⚠️  IMPORTANTE:                                                        │
│  • Mesmo administradores não conseguem ver a senha original             │
│  • Não existe "recuperar senha", apenas "redefinir"                     │
│  • Cada senha tem seu próprio salt único                                │
│  • O hash inclui os parâmetros do algoritmo para futuras migrações      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Características do scrypt:**

- **Resistente a ataques de força bruta**: Requer muita memória para computar
- **Salt único por senha**: Mesmo senhas iguais geram hashes diferentes
- **Timing-safe comparison**: Previne ataques de timing
- **Parâmetros ajustáveis**: Pode aumentar a dificuldade conforme hardware evolui

### Autenticação de Usuários

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUXO DE AUTENTICAÇÃO                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Login: POST /api/v1/login                               │
│     Body: { email, password }                               │
│     → Senha verificada contra hash no banco                 │
│     Response: { type, value, expiresAt, user }              │
│                                                             │
│  2. Requisições autenticadas:                               │
│     Header: Authorization: Bearer <token>                   │
│     → Access token Adonis (hash SHA-256 no banco)           │
│                                                             │
│  3. Logout: DELETE /api/v1/logout                           │
│     → Token invalidado (removido do banco)                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Autenticação de Máquinas

```
┌─────────────────────────────────────────────────────────────┐
│                   AUTENTICAÇÃO DE MÁQUINAS                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  • Cada máquina possui um Agent Key único de 512 bits       │
│  • Header: Authorization: Bearer <token>                    │
│  • Cache de 5 minutos para reduzir consultas ao banco       │
│  • Usado apenas nas rotas /api/v1/agent/*                   │
│                                                             │
│  Geração do Agent Key (Machine.assignToken):                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ randomBytes(64).toString('hex') // 64 bytes = 512 bits  │ │
│  │ // 128 chars hex; ex.: "d08248929bf8bcae92a2e20421..."  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Rotação de Token:                                          │
│  • Admin pode regenerar token se comprometido               │
│  • POST /api/v1/machines/:id/regenerate-token               │
│  • Agente deve ser reconfigurado com novo token             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Regras de Negócio

### Regra de Gap entre Alocações

```
┌─────────────────────────────────────────────────────────────────────────┐
│              GAP E CICLO PÓS-RESERVA (env LAB_ALLOCATION_*)             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Grace (`LAB_ALLOCATION_GRACE_MINUTES`, padrão 10): bash após endTime;   │
│    mesmo valor = intervalo mínimo entre reservas (conflito calendário)  │
│  SFTP (`LAB_ALLOCATION_POST_SFTP_MINUTES`, padrão 1440):chave após grace│
│  Delete (`LAB_ALLOCATION_DELETE_USER_DAYS`, padrão 7): userdel no SO    │
│  Aprovação (`LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL`): pending vs approved│
│  `lifecycleStatus` (JSON): active | grace | sftp além do `status` DB   │
│                                                                         │
│  Linha do tempo (reserva normal):                                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ start    end   +grace    +postSftp   +7d                         │   │
│  │  │───────│────│────│──────────────│────────│                     │   │
│  │  │ bash  │grace│ SFTP c/ chave   │ sem chave │ teardown          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  Antes de `startTime`: sem provisioning (conta não criada no SO)        │
│                                                                         │
│  Finalização antecipada (`POST /allocations/:id/finish`):               │
│  • `status` → `finished`, `endTime` → agora (UTC)                       │
│  • Pula grace e SFTP com chave — fase operacional vai a `no_key`        │
│  • Estender (`POST /extend`): antes do início, `active` ou `grace` (não SFTP) │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### `LAB_ALLOCATION_GRACE_MINUTES` (padrão: 10)

Variável única no `.env` com **dois papéis**:

1. **Grace pós-`endTime`** (somente reserva `approved` no calendário): minutos extras de bash SSH após o horário reservado; habilita `POST /extend` e `lifecycleStatus: grace`.
2. **Intervalo entre reservas**: ao criar ou estender, a API recusa sobreposição até `endTime + grace` da reserva existente (mesmo valor — não há variável `GAP` separada).

Exposto em `GET /api/config` em `allocation.access.graceMinutes`. Respostas de alocação incluem `lifecycleStatus` (`active`, `grace`, `sftp`, …) calculado no servidor.

### Limite de antecedência (`LAB_ALLOCATION_MAX_FUTURE_DAYS`)

Reservas futuras não podem terminar além do horizonte configurado no `.env` (padrão: 365 dias). Create, `PATCH` (admin) e `POST /allocations/:id/extend` retornam `ALLOCATION_TOO_FAR` se violar.

---

## Manutenibilidade do sistema

O laboratório combina **configuração central** (`.env` + overrides em runtime) com **rotas admin** para o front operar retenção, correções e políticas sem migrations.

### Banco SQLite

| Ambiente | Arquivo | Notas |
|----------|---------|-------|
| Dev/prod | `apps/api/tmp/db.sqlite3` | Definido em `config/database.ts` (não alterado por `DB_CONNECTION` no `.env`) |
| Testes | `apps/api/tmp/test.sqlite3` | `NODE_ENV=test` — isolado do dev server |

Trocar `.env` **não** apaga dados. `migration:fresh` recria o schema e **apaga** o conteúdo.

### Camadas de configuração

| Camada | Onde | Efeito | Restart? |
|--------|------|--------|----------|
| `.env` | `apps/api/.env` | Defaults de retenção, cron, notificações, calendário | Sim (schedulers) |
| Runtime settings | `storage/lab/runtime_settings.json` | `requireAdminApproval`, `publicNames` via `PUT /lab/settings` | Não |
| Telemetria global | `storage/lab/telemetry_presets.json` | Perfis fast/eco via `PUT /lab/telemetry-presets` | Não |
| Dados operacionais | SQLite | Alocações, grupos, máquinas — CRUD + prune | Não |

`GET /api/config` reflete valores **efetivos** (env + runtime) para o front bootstrapar calendário e formulários.

### Retenção automática (`LAB_SCHEDULER_MAINTENANCE_CRON`)

Cron único (padrão `0 */4 * * *`, a cada 4 h) executa, em sequência:

1. Prune de tokens expirados
2. Resumo TWA (`LAB_SUMMARIZE_AFTER_HOURS` após `endTime`)
3. Prune de alocações terminais (`LAB_PRUNE_ALLOCATION_DAYS` após `endTime`; telemetria e métrica em **CASCADE**)
4. Prune de notificações (`LAB_PRUNE_NOTIFICATION_DAYS` após `createdAt`)
5. Prune de tentativas SSH (`LAB_PRUNE_SSH_ATTEMPTS_DAYS`)

Disparo manual equivalente: `POST /api/v1/system/maintenance/run`.

### Rotas admin para o front de manutenção

| Área | Rotas | Uso no front |
|------|-------|--------------|
| **Manutenção em lote** | `POST /system/maintenance/run` + `DELETE /system/prune/{notifications,ssh-attempts}` | Rotina completa (inclui alocações); prune seletivo só notificações e SSH |
| **Exclusão pontual** | `DELETE /system/{allocations,ssh-attempts}/:id` | Correção cirúrgica |
| **SSH por intervalo** | `DELETE /ssh-attempts/:keepDays` | Atalho: manter últimos N dias |
| **Alocações alheias** | `PATCH /allocations/:id` (admin: `startTime`, `endTime`, `status`) | Corrigir horários com validação de conflito |
| **Grupos** | CRUD `/machine-groups` + `machineIds` no body | Renomear, descrever, reassociar máquinas |
| **Políticas runtime** | `GET`/`PUT /lab/settings` | Toggle aprovação obrigatória e nomes no calendário |
| **Telemetria global** | `GET`/`PUT /lab/telemetry-presets` | Perfis fast/eco do parque |

Métricas resumidas (`allocation_metrics`) **não** têm exclusão individual — removem-se com a alocação (prune ou `DELETE /system/allocations/:id`).

### Flags alteráveis pela API (sem restart)

- **`requireAdminApproval`** — novas reservas de usuário nascem `pending` quando `true`. Reservas existentes mantêm status.
- **`publicNames`** — usuários normais passam a ver `user.fullName` no calendário/histórico (mesma visão do admin no hover). Só afeta respostas da API.

Ambas persistem em `storage/lab/runtime_settings.json` e sobrescrevem o `.env` até o arquivo ser removido ou a API reiniciar com outro `.env`.

---

## Limites de variáveis de ambiente

Valores fora da faixa são **clampados** ao intervalo ou caem no default (sem erro no boot). Fonte: `app/services/lab_env_limits.ts`.

| Variável | Mín | Máx | Default | Notas |
|----------|-----|-----|---------|-------|
| `LAB_CALENDAR_PAST_DAYS` | 1 | 3650 | 30 | |
| `LAB_CALENDAR_FUTURE_DAYS_OPTIONS` | 1 | 3650 | 90,180,365 | Máx 20 itens na lista |
| `LAB_CALENDAR_DEFAULT_FUTURE_DAYS` | 1 | 3650 | 1ª opção | Normalizado para estar na lista |
| `LAB_ALLOCATION_MAX_FUTURE_DAYS` | 1 | 3650 | 365 | |
| `LAB_ALLOCATION_MIN_DURATION_MINUTES` | 1 | 1440 | 15 | |
| `LAB_SCHEDULE_START_HOUR` | 0 | 24 | 0 | Exposto ao front; validação de faixa no create ainda não aplicada |
| `LAB_SCHEDULE_END_HOUR` | 0 | 24 | 24 | Idem |
| `LAB_ALLOCATION_GRACE_MINUTES` | 0 | 1440 | 10 | 0 = desativado |
| `LAB_ALLOCATION_POST_SFTP_MINUTES` | 0 | 10080 | 1440 | 0 = desativado |
| `LAB_ALLOCATION_DELETE_USER_DAYS` | 0 | 365 | 7 | |
| `LAB_SUMMARIZE_AFTER_HOURS` | 1 | 8760 | 168 | |
| `LAB_PRUNE_ALLOCATION_DAYS` | 1 | 3650 | 30 | Conta desde `endTime` |
| `LAB_PRUNE_NOTIFICATION_DAYS` | 1 | 3650 | 30 | Conta desde `createdAt` |
| `LAB_PRUNE_SSH_ATTEMPTS_DAYS` | 1 | 3650 | 30 | Mantém últimos N dias |
| `LAB_NOTIF_UPCOMING_MINUTES` | 1 | 1440 | 10 | |
| `LAB_NOTIF_SSH_KEY_MINUTES` | 1 | 1440 | 5 | |
| `LAB_NOTIF_SSH_FLOOD_WINDOW_MINUTES` | 1 | 1440 | 15 | |
| `LAB_NOTIF_SSH_FLOOD_THRESHOLD` | 1 | 10000 | 20 | |
| `LAB_NOTIF_SSH_FLOOD_COOLDOWN_HOURS` | 1 | 168 | 1 | |
| `LAB_NOTIF_AGENT_OFFLINE_MINUTES` | 1 | 1440 | 10 | |
| `LAB_NOTIF_AGENT_OFFLINE_COOLDOWN_HOURS` | 1 | 168 | 24 | |
| `LAB_AUTH_TOKEN_EXPIRES_IN` | — | — | `6 hours` | String Adonis (`6 hours`, `1 day`, …) |
| `TZ` | — | — | `America/Sao_Paulo` | IANA; inválido → fallback |
| `LAB_SCHEDULER_*_CRON` | — | — | ver `.env.example` | Expressão cron node-cron |

`LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL` e `LAB_ALLOCATION_PUBLIC_NAMES` são booleanos (`true`/`false`/`1`/`0`); efetivos via runtime settings quando definidos pela API.

---

## API Endpoints

A API é segmentada por prefixos e versões para isolar a lógica de interação humana da lógica de automação das máquinas.

**Base URL interface:** `/api/v1` · **Utilitários públicos:** `/api` · **Agente:** `/api/v1/agent`

---

### 0. Utilitários públicos (`/api`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/alive` | Health check. |
| GET | `/time` | UTC + relógio local do lab (`TZ`). |
| GET | `/config` | Calendário, limites, auth e **`telemetry.presets`** (`fast`/`eco`) + `defaultOfflinePreset: eco` para o agente antes do 1º heartbeat. |

---

### 1. Interface & Gestão (`/api/v1`)

_Destinadas ao Frontend Web/Mobile. Requer Header `Authorization: Bearer <USER_TOKEN>` (exceto login)._

---

#### 🔐 Auth & Perfil

##### `POST /api/v1/login`

Autenticação e emissão de access token Adonis (`type: bearer`).

**Permissão:** Pública

**Request Body:**

```json
{
  "email": "usuario@email.com",
  "password": "senha1234"
}
```

**Response (200):**

```json
{
  "type": "bearer",
  "value": "oat_NzI1...",
  "expiresAt": "2026-01-28T18:00:00.000Z",
  "user": {
    "id": 1,
    "fullName": "Nome do Usuário",
    "email": "usuario@email.com",
    "role": "user",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

**Erros:**

- `400` - Credenciais inválidas

---

##### `DELETE /api/v1/logout`

Invalidação do token atual.

**Permissão:** Geral (autenticado)

**Response (200):**

```json
{
  "message": "Logged out successfully"
}
```

---

##### `GET /api/v1/me`

Retorna dados do usuário autenticado.

**Permissão:** Geral (autenticado)

**Response (200):**

```json
{
  "id": 1,
  "fullName": "Nome do Usuário",
  "email": "usuario@email.com",
  "role": "user",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

#### 👥 Users (Usuários)

##### `POST /api/v1/users`

Cadastrar novo usuário.

**Permissão:** Admin

**Request Body:**

```json
{
  "fullName": "Novo Usuário",
  "email": "novo@email.com",
  "password": "senha1234",
  "role": "user"
}
```

| Campo      | Tipo   | Obrigatório | Descrição                       |
| :--------- | :----- | :---------- | :------------------------------ |
| `fullName` | string | ✅          | Nome completo (4-63 caracteres) |
| `email`    | string | ✅          | Email único válido              |
| `password` | string | ✅          | Senha (8-63 caracteres)         |
| `role`     | enum   | ❌          | `user` (padrão) ou `admin`      |

**Response (201):**

```json
{
  "id": 2,
  "fullName": "Novo Usuário",
  "email": "novo@email.com",
  "role": "user",
  "createdAt": "2026-01-28T12:00:00.000Z",
  "updatedAt": "2026-01-28T12:00:00.000Z"
}
```

---

##### `GET /api/v1/users`

Listar todos os usuários com paginação.

**Permissão:** Admin

**Query Params:**
| Param | Tipo | Padrão | Descrição |
| :------ | :----- | :----- | :--------------------- |
| `page` | number | 1 | Página atual |
| `limit` | number | 20 | Itens por página (max: 100) |

**Response (200):**

```json
{
  "meta": {
    "total": 50,
    "perPage": 20,
    "currentPage": 1,
    "lastPage": 3
  },
  "data": [
    {
      "id": 1,
      "fullName": "Admin",
      "email": "admin@email.com",
      "role": "admin",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

##### `GET /api/v1/users/:id`

Detalhes de um usuário específico.

**Permissão:** Admin

**Response (200):**

```json
{
  "id": 1,
  "fullName": "Nome do Usuário",
  "email": "usuario@email.com",
  "role": "user",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

##### `PUT /api/v1/users/:id`

Atualizar perfil do usuário.

**Permissão:** Geral (usuário atualiza seu próprio perfil)

**Request Body:**

```json
{
  "fullName": "Nome Atualizado",
  "email": "novoemail@email.com",
  "password": "novaSenha123"
}
```

| Campo      | Tipo   | Obrigatório | Descrição                       |
| :--------- | :----- | :---------- | :------------------------------ |
| `fullName` | string | ❌          | Nome completo (4-63 caracteres) |
| `email`    | string | ❌          | Email único válido              |
| `password` | string | ❌          | Nova senha (8-63 caracteres)    |
| `role`     | enum   | ❌          | `user` ou `admin` (Admin only)  |

**Response (200):**

```json
{
  "id": 1,
  "fullName": "Nome Atualizado",
  "email": "novoemail@email.com",
  "role": "user",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-28T14:00:00.000Z"
}
```

---

##### `DELETE /api/v1/users/:id`

Remover usuário.

**Permissão:** Admin

**Response (200):**

```json
{
  "message": "Usuário removido com sucesso"
}
```

---

##### `GET /api/v1/users/:id/allocations`

Histórico de alocações de um usuário específico.

**Permissão:** Admin

**Query Params:**
| Param | Tipo | Padrão | Descrição |
| :------ | :----- | :----- | :--------------------- |
| `page` | number | 1 | Página atual |
| `limit` | number | 20 | Itens por página |

**Response (200):**

```json
{
  "meta": { "total": 10, "perPage": 20, "currentPage": 1, "lastPage": 1 },
  "data": [
    {
      "id": 1,
      "userId": 3,
      "machineId": 1,
      "startTime": "2026-01-28T08:00:00.000Z",
      "endTime": "2026-01-28T12:00:00.000Z",
      "reason": "Projeto de TCC",
      "status": "approved",
      "machine": { "id": 1, "name": "PC-LAB-01" },
      "metric": null
    }
  ]
}
```

---

#### 🖥️ Machines (Laboratórios)

##### `POST /api/v1/machines`

Cadastrar máquina e gerar Agent Key para o agente.

**Permissão:** Admin

**Request Body:**

```json
{
  "name": "PC-LAB-01",
  "description": "Computador do laboratório 1",
  "cpuModel": "Intel Core i7-12700K",
  "gpuModel": "NVIDIA GeForce RTX 3060",
  "totalRamGb": 16,
  "totalDiskGb": 512,
  "ipAddress": "192.168.1.100",
  "status": "available"
}
```

| Campo         | Tipo   | Obrigatório | Descrição                                         |
| :------------ | :----- | :---------- | :------------------------------------------------ |
| `name`        | string | ✅          | Nome da máquina (2-50 caracteres)                 |
| `description` | string | ❌          | Descrição (max: 255)                              |
| `cpuModel`    | string | ❌          | Modelo do processador                             |
| `gpuModel`    | string | ❌          | Modelo da GPU                                     |
| `totalRamGb`  | number | ❌          | RAM total em GB                                   |
| `ipAddress`   | string | ❌          | Endereço IP                                       |
| `status`      | enum   | ❌          | Modo operacional do admin: `available`, `offline`, `maintenance` |

**Response (201):**

```json
{
  "machine": {
    "id": 1,
    "name": "PC-LAB-01",
    "description": "Computador do laboratório 1",
    "cpuModel": "Intel Core i7-12700K",
    "gpuModel": "NVIDIA GeForce RTX 3060",
    "totalRamGb": 16,
    "totalDiskGb": 512,
    "status": "available",
    "createdAt": "2026-01-28T12:00:00.000Z"
  },
  "token": "d08248929bf8bcae92a2e204219c7941..."
}
```

> ⚠️ **IMPORTANTE:** O `token` só é retornado na criação. Guarde-o para configurar o agente!

---

##### `GET /api/v1/machines`

Inventário de máquinas com status em tempo real.

**Permissão:** Geral (autenticado)

**Response (200):**

```json
[
  {
    "id": 1,
    "name": "PC-LAB-01",
    "description": "Computador do laboratório 1",
    "cpuModel": "Intel Core i7-12700K",
    "gpuModel": "NVIDIA GeForce RTX 3060",
    "totalRamGb": 16,
    "totalDiskGb": 512,
    "status": "available",
    "hostFingerprint": "SHA256:abcd1234...",
    "latestTelemetry": {
      "cpuUsage": 45,
      "cpuTemp": 72,
      "gpuUsage": 82,
      "gpuTemp": 68,
      "ramUsedGb": 96.5,
      "ramTotalGb": 128,
      "vramUsedGb": 38.2,
      "vramTotalGb": 48,
      "timestamp": "2026-01-28T12:00:00.000Z"
    }
  }
]
```

> `latestTelemetry`: `telemetryBuffer.getLatest()`; se ausente, fallback `chartTelemetryBuffer.getLatestEntry()`.

> **Status × modo operacional:** o admin define apenas `operationalMode` (`available` = auto, `offline` = desativada, `maintenance`) — persistido na coluna `status`. A resposta serializa `operationalMode` **e** um `status` **efetivo** computado por `resolveEffectiveMachineStatus` (`available` · `occupied` · `maintenance` · `offline` · **`disabled`**): modo `offline` → `disabled`; heartbeat parado &gt; 24 h → `offline`; alocação ativa/grace → `occupied`. Reservas são bloqueadas quando o efetivo é `maintenance`/`offline`/`disabled`.

---

##### `GET /api/v1/machines/:id`

Detalhes técnicos de uma máquina específica (mesmo payload para admin e usuário autenticado).

**Permissão:** Geral (autenticado)

**Segurança:** o `token` do agente **não** aparece nesta rota (nem para admin). Use `hostFingerprint` para conferência SSH. Token só em `POST /machines` (criação) e `POST /machines/:id/regenerate-token`.

**Response (200):**

```json
{
  "id": 1,
  "name": "VID-RENDER-01",
  "description": "Treino VideoMAE / export H.265",
  "cpuModel": "AMD Ryzen Threadripper PRO 5975WX",
  "gpuModel": "NVIDIA RTX A6000",
  "totalRamGb": 128,
  "totalVramGb": 48,
  "totalDiskGb": 8000,
  "ipAddress": "192.168.1.100",
  "hostFingerprint": "SHA256:abcd1234...",
  "status": "occupied",
  "telemetryPreset": "fast",
  "lastSeenAt": "2026-01-28T12:00:00.000Z",
  "tokenRotatedAt": null,
  "machineGroupId": 1,
  "group": { "id": 1, "title": "CUDA — Pesquisa em vídeo", "description": "…" },
  "disks": [
    { "id": 0, "device": "/dev/nvme0n1", "mountpoint": "/", "fstype": "ext4", "totalGb": 190.2, "freeGb": 102.6 }
  ],
  "latestTelemetry": {
    "cpuUsage": 45,
    "cpuTemp": 72,
    "cpuFreqMhz": 4200,
    "gpuUsage": 82,
    "gpuTemp": 68,
    "gpuPowerWatts": 285,
    "ramTotalGb": 128,
    "ramUsedGb": 96.5,
    "swapTotalGb": 32,
    "swapUsedGb": 4.2,
    "vramTotalGb": 48,
    "vramUsedGb": 38.2,
    "disksInfo": [{ "mountpoint": "/", "usagePct": 65, "freeGb": 102.6, "readMbps": 120, "writeMbps": 45 }],
    "diskReadMbps": 120,
    "diskWriteMbps": 45,
    "downloadMbps": 50,
    "uploadMbps": 10,
    "moboTemperature": 42,
    "activeUsers": [{ "username": "lab.maria_silva", "terminal": "pts/0", "host": "10.0.0.5", "isSsh": true }],
    "timestamp": "2026-01-28T12:00:00.000Z"
  },
  "createdAt": "2026-01-28T12:00:00.000Z",
  "updatedAt": "2026-01-28T12:00:00.000Z"
}
```

> `processes` só aparece em histórico/stream ou quando o admin dispara `request-processes`; o snapshot de parque não inclui lista de processos.

---

##### `PUT /api/v1/machines/:id`

Atualizar dados de uma máquina.

**Permissão:** Admin

**Request Body:** (todos os campos são opcionais)

```json
{
  "name": "PC-LAB-01-ATUALIZADO",
  "status": "maintenance"
}
```

**Response (200):** Máquina atualizada (mesmo formato do GET, sem token)

---

##### `DELETE /api/v1/machines/:id`

Remover máquina do sistema.

**Permissão:** Admin

**Response (204):** No Content

---

##### `POST /api/v1/machines/:id/regenerate-token`

Regenera o token de autenticação da máquina (rotação de segurança).

**Permissão:** Admin

**Response (200):**

```json
{
  "message": "Token regenerado com sucesso. Configure o agente com o novo token.",
  "machineId": 1,
  "machineName": "PC-LAB-01",
  "token": "novo_token_gerado_aqui...",
  "tokenRotatedAt": "2026-01-28T14:00:00.000Z"
}
```

> ⚠️ **Após regenerar:** Atualize o arquivo de config do agente na máquina física.

---

##### `GET /api/v1/machines/:id/telemetry`

Gráfico 24 h (`chartHistory`) + snapshot realtime + telemetrias de processos de alocações não resumidas (paginadas).

**Permissão:** Usuário autenticado

**Query Params:**
| Param | Tipo | Padrão | Descrição |
| :---------- | :----- | :----- | :--------------------------- |
| `page` | number | 1 | Página de `history.data` |
| `limit` | number | 100 | Itens por página (max: 1000) |

**Campos da resposta:**

| Campo | Origem | Observação |
|-------|--------|------------|
| `realtime` | `telemetryBuffer.getLatest()` | Sempre a amostra mais recente do agente (alocação ou ocioso) |
| `chartHistory.points` | alias de `chartSeries` | Compatibilidade; mesmo array normalizado |
| `chartHistory.chartSeries` | `chartTelemetryBuffer.getChartSeries()` | ~96 pontos @ 15 min fechados + preview da janela aberta |
| `chartHistory.meta` | metadados do buffer de gráfico | `retentionHours`, `lastBufferTimestamp`, etc. |
| `history.data` | tabela `telemetries` | Snapshots com **processos** de alocações não resumidas; não usado pelo painel ao vivo |

**Response (200):**

```json
{
  "realtime": { "cpuUsage": 12.5, "timestamp": "2026-06-05T12:00:00.000Z" },
  "chartHistory": {
    "points": [
      { "timestamp": "2026-06-05T11:00:00.000Z", "cpuUsage": 8.2, "gpuUsage": null }
    ],
    "chartSeries": [
      { "timestamp": "2026-06-05T11:00:00.000Z", "cpuUsage": 8.2 }
    ],
    "meta": {
      "retentionHours": 24,
      "recentResolutionMinutes": 1,
      "olderResolutionMinutes": 10,
      "chartBucketMinutes": 15,
      "pointCount": 42,
      "chartPointCount": 96,
      "lastBufferTimestamp": "2026-06-05T11:59:00.000Z",
      "lastChartTimestamp": "2026-06-05T11:45:00.000Z"
    }
  },
  "history": {
    "meta": { "total": 0, "perPage": 100, "currentPage": 1 },
    "data": []
  }
}
```

> `chartHistory` acumula em **todo** POST do agente (ocioso ou alocação). Escalares da sessão no resumo vêm desse buffer; SQLite guarda só amostras com `processes`. Valores normalizados (÷10). Perdido ao reiniciar a API.

> `history.data`: fila SQLite de processos (flush de `telemetryBuffer`); escalares da sessão ficam no `chartTelemetryBuffer`, não aqui.

---

##### `GET /api/v1/machines/:id/telemetry/stream`

Último lote do agente (≤ 15 amostras) + snapshot `latest` — **fonte do monitoramento ao vivo** no detalhe da máquina.

**Permissão:** Usuário autenticado

**Query:** `count` (opcional, máx. 15)

**Response (200):**

```json
{
  "machineId": 1,
  "batch": [
    { "timestamp": "…", "cpuUsage": 12.3, "processes": [] }
  ],
  "latest": { "timestamp": "…", "cpuUsage": 12.3 },
  "total": 1
}
```

> Lê **sempre** `telemetryBuffer` (memória), independente de alocação. Processos e `activeUsers` vêm da amostra bruta do lote, não do `chartTelemetryBuffer`.

---

##### `GET /api/v1/machines/:id/allocations`

Listar alocações de uma máquina.

**Permissão:** Geral (autenticado)

**Query Params:**
| Param | Tipo | Padrão | Descrição |
| :------ | :----- | :----- | :--------------------- |
| `page` | number | 1 | Página atual |
| `limit` | number | 20 | Itens por página |

**Response para Admin (200):**

```json
{
  "meta": { "total": 10, "perPage": 20, "currentPage": 1, "lastPage": 1 },
  "data": [
    {
      "id": 1,
      "userId": 3,
      "machineId": 1,
      "startTime": "2026-01-28T08:00:00.000Z",
      "endTime": "2026-01-28T12:00:00.000Z",
      "reason": "Projeto de TCC",
      "status": "approved",
      "user": { "id": 3, "fullName": "Aluno" }
    }
  ]
}
```

**Response para Usuário Normal (200):**

Sem `userId`, `reason` nem métricas de terceiros. Inclui `isOwn` quando a reserva é do usuário autenticado.

- `LAB_ALLOCATION_PUBLIC_NAMES=false` (padrão): sem objeto `user`.
- `LAB_ALLOCATION_PUBLIC_NAMES=true`: `user: { id, fullName }` em cada item (motivo continua só para admin).

```json
{
  "meta": { "total": 10, "perPage": 20, "currentPage": 1, "lastPage": 1 },
  "data": [
    {
      "id": 1,
      "machineId": 1,
      "startTime": "2026-01-28T08:00:00.000Z",
      "endTime": "2026-01-28T12:00:00.000Z",
      "status": "approved",
      "isOwn": false
    }
  ]
}
```

A flag também aparece em `GET /api/config` → `allocation.publicNames`.

---

#### 📅 Allocations (Reservas & Sessões)

##### `POST /api/v1/allocations`

Criar uma nova alocação (reserva).

**Permissão:** Geral (autenticado)

**Request Body:**

```json
{
  "machineId": 1,
  "startTime": "2026-01-29T08:00:00Z",
  "endTime": "2026-01-29T12:00:00Z",
  "reason": "Projeto de TCC"
}
```

| Campo       | Tipo    | Obrigatório | Descrição                                    |
| :---------- | :------ | :---------- | :------------------------------------------- |
| `machineId` | number  | ✅          | ID da máquina                                |
| `startTime` | ISO8601 | ✅          | Data/hora de início                          |
| `endTime`   | ISO8601 | ✅          | Data/hora de término                         |
| `reason`    | string  | ❌          | Motivo da reserva (max: 255)                 |
| `userId`    | number  | ❌          | ID do usuário (Admin pode especificar outro) |
| `status`    | enum    | ❌          | Status inicial (Admin only)                  |

**Response (201):**

```json
{
  "id": 1,
  "userId": 3,
  "machineId": 1,
  "startTime": "2026-01-29T08:00:00.000Z",
  "endTime": "2026-01-29T12:00:00.000Z",
  "reason": "Projeto de TCC",
  "status": "approved",
  "user": { "id": 3, "fullName": "Aluno" },
  "machine": { "id": 1, "name": "PC-LAB-01" }
}
```

**Erros:**

- `400` `MACHINE_IN_MAINTENANCE` - Máquina em manutenção
- `409` `ALLOCATION_CONFLICT` - Conflito de horário com outra alocação

---

##### `GET /api/v1/allocations`

Listar alocações com filtros.

**Permissão:** Geral (usuário vê apenas suas alocações, admin vê todas)

**Query Params:**
| Param | Tipo | Padrão | Descrição |
| :---------- | :----- | :----- | :----------------------------------------- |
| `machineId` | number | - | Filtrar por máquina |
| `userId` | number | - | Filtrar por usuário (Admin only) |
| `status` | enum | - | `pending`, `approved`, `denied`, `cancelled`, `finished` |
| `page` | number | 1 | Página atual |
| `limit` | number | 20 | Itens por página (max: 100) |

**Response (200):**

```json
{
  "meta": { "total": 25, "perPage": 20, "currentPage": 1, "lastPage": 2 },
  "data": [
    {
      "id": 1,
      "userId": 3,
      "machineId": 1,
      "startTime": "2026-01-28T08:00:00.000Z",
      "endTime": "2026-01-28T12:00:00.000Z",
      "reason": "Projeto de TCC",
      "status": "approved",
      "user": { "id": 3, "fullName": "Aluno" },
      "machine": { "id": 1, "name": "PC-LAB-01" }
    }
  ]
}
```

---

##### `PATCH /api/v1/allocations/:id`

Atualizar alocação (status e, para admin, horários de alocações alheias).

**Permissão:** Geral — usuário só cancela as próprias; admin altera qualquer registro.

**Request Body:**

```json
{
  "status": "approved",
  "startTime": "2026-02-01T08:00:00Z",
  "endTime": "2026-02-01T12:00:00Z",
  "reason": "Ajuste pelo admin"
}
```

| Campo       | Tipo    | Admin | Usuário | Descrição |
| :---------- | :------ | :---- | :------ | :-------- |
| `status`    | enum    | ✅    | `cancelled` apenas | `pending`, `approved`, `denied`, `cancelled`, `finished` |
| `startTime` | ISO8601 | ✅    | ❌      | UTC; valida conflito, duração mínima e limite futuro |
| `endTime`   | ISO8601 | ✅    | ❌      | Idem |
| `reason`    | string  | ✅    | ❌      | Máx 200 caracteres |

**Admin — alteração de horários:**

- Bloqueado para `status: finished` (`CANNOT_CHANGE_FINISHED_TIMES`)
- Mesmas regras de `POST /allocations` (conflito de calendário, `ALLOCATION_TOO_FAR`, `ALLOCATION_TOO_SHORT`)
- Não altera `userId` nem `machineId` por esta rota

**Response (200):** Alocação atualizada (`serializeAllocation`)

**Erros:**

- `403` `NOT_OWNER` / `INVALID_STATUS_CHANGE` / `CANNOT_CANCEL` / `CANNOT_CHANGE_TIME`
- `400` `CANNOT_CHANGE_FINISHED_TIMES` / `INVALID_RANGE` / `ALLOCATION_TOO_FAR` / `ALLOCATION_TOO_SHORT`
- `409` `ALLOCATION_CONFLICT`

---

##### `DELETE /api/v1/allocations/:id`

Soft-delete de uma alocação. Oculta do histórico do usuário, mas mantém o registro para administração.

**Permissão:** Geral (usuário só pode remover suas próprias alocações)

**Comportamento:**

- Alocação `pendente`/`aprovada` que ainda não começou → cancela automaticamente + oculta
- Alocação `finalizada`/`cancelada`/`negada` → apenas oculta do histórico
- Alocação em andamento → bloqueado (não pode remover)

**Response (200):**

```json
{
  "message": "Alocação removida do seu histórico.",
  "id": 1,
  "status": "cancelled"
}
```

**Erros:**

- `403` `NOT_OWNER` - Não é o dono da alocação
- `403` `ALLOCATION_IN_PROGRESS` - Alocação em andamento não pode ser removida

---

##### `POST /api/v1/allocations/:id/summary`

Gerar resumo/métricas de uma sessão finalizada.

**Permissão:** Admin

**Response (201):**

```json
{
  "id": 1,
  "allocationId": 1,
  "avgCpuUsage": 45.0,
  "maxCpuUsage": 85.0,
  "avgGpuUsage": 20.0,
  "maxGpuUsage": 60.0,
  "avgRamUsedGb": 14.0,
  "maxRamUsedGb": 22.0,
  "sessionDurationMinutes": 240,
  "chartSeries": [
    {
      "timestamp": "2026-01-28T10:00:00.000Z",
      "cpuUsage": 42.1,
      "gpuUsage": null
    }
  ],
  "createdAt": "2026-01-28T12:00:00.000Z"
}
```

> Linhas em `telemetries` (processos) são **removidas** após resumo; escalares TWA vêm do `chartTelemetryBuffer` na geração. Use `chartSeries` no resumo para gráfico histórico da sessão.

**Erros:**

- `404` `NO_TELEMETRY` - Sem dados de telemetria no período
- `409` `SUMMARY_EXISTS` - Resumo já existe para esta alocação

---

##### `GET /api/v1/allocations/:id/summary`

Ver resumo/métricas de uma sessão.

**Permissão:** Geral (usuário só vê resumo de suas próprias alocações)

**Response (200):** Mesmo formato do POST

**Erros:**

- `403` `NOT_OWNER` - Não é o dono da alocação
- `404` `NO_SUMMARY` - Alocação ainda não tem resumo

---

#### 🗂️ Machine Groups (Admin Only)

Prefixo: `/api/v1/machine-groups`

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Lista grupos com `machines` embutidas |
| `POST` | `/` | Cria grupo; body opcional `machineIds: number[]` |
| `GET` | `/:id` | Detalhe + máquinas |
| `PUT` | `/:id` | Atualiza `title`, `description` e/ou `machineIds` (substitui associação) |
| `DELETE` | `/:id` | Remove grupo; máquinas ficam sem grupo (`SET NULL`) |

**Body (create/update):**

```json
{
  "title": "CUDA — Pesquisa em vídeo",
  "description": "Máquinas de treino",
  "machineIds": [1, 2, 5]
}
```

`machineIds: []` remove todas as máquinas do grupo. Erro `400 MACHINES_NOT_FOUND` se algum ID não existir.

---

#### ⚙️ Lab Settings (Admin Only)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/v1/lab/settings` | Valores efetivos + `sources` (`env` ou `runtime`) |
| `PUT` | `/api/v1/lab/settings` | Persiste em `storage/lab/runtime_settings.json` |

**Request (PUT):**

```json
{
  "requireAdminApproval": true,
  "publicNames": true
}
```

Refletido imediatamente em `GET /api/config` → `allocation.requireAdminApproval` e `allocation.publicNames`.

---

#### 🧹 System — manutenção (Admin Only)

Prefixo: `/api/v1/system`

##### `POST /api/v1/system/maintenance/run`

Executa o mesmo fluxo do cron de manutenção.

**Response (200):** `{ message, tokens, summarized, allocations, notifications, sshAttempts }`

---

##### Exclusão pontual

| Método | Rota | Response |
|--------|------|----------|
| `DELETE` | `/allocations/:id` | 204 (hard delete; CASCADE telemetria + métrica) |
| `DELETE` | `/ssh-attempts/:id` | 204 |

---

##### Prune em lote

Alocações terminais só são removidas pela rotina completa (`POST /maintenance/run` ou cron), com `LAB_PRUNE_ALLOCATION_DAYS` comparado a **`endTime`**.

Prune seletivo — sem body, usa defaults do `.env`. Body opcional sobrescreve o corte.

**`DELETE /api/v1/system/prune/notifications`**

```json
{ "before": "2025-06-01T00:00:00Z", "userId": 3 }
```

Padrão: `createdAt` anterior a `LAB_PRUNE_NOTIFICATION_DAYS`.

**`DELETE /api/v1/system/prune/ssh-attempts`**

```json
{ "keepDays": 30, "machineId": 1 }
```

Padrão: `LAB_PRUNE_SSH_ATTEMPTS_DAYS`.

**Atalho:** `DELETE /api/v1/ssh-attempts/:keepDays` — mesmo efeito (ex.: `/ssh-attempts/4` mantém 4 dias).

---

### 2. Agente (`/api/v1/agent`)

Autenticação: `Authorization: Bearer <MACHINE_TOKEN>` (middleware `machineAuth`). Ver também `apps/agent/MODULE.md`.

| Método | Rota | Descrição |
|--------|------|-----------|
| PUT | `/sync-specs` | Boot: specs estáveis (**fill-empty**), discos, fingerprint. Não sobrescreve admin. |
| POST | `/heartbeat` | A cada ~30s: provisionamento SSH, usuários ativos, lote de `sshAttempts`. |
| POST | `/telemetry` | Lotes de métricas (persistidas com alocação ativa); atualiza `disks` se `disksInfo`; métricas **null** se toggle off. |

**Resposta típica do heartbeat:**

```json
{
  "status": "acknowledged",
  "agentConfig": {
    "telemetry": {
      "intervalSeconds": 5,
      "batchSize": 5,
      "telemetrySet": { "cpu": true, "gpu": true, "ramAndSwap": true }
    }
  },
  "provisioning": [
    {
      "systemUsername": "lab.maria_silva",
      "publicKey": "ssh-ed25519 AAAA…",
      "accessState": "full_shell",
      "revokeSshKey": false
    }
  ],
  "accessControl": { "shouldBlock": false },
  "currentAllocation": { "id": 3, "userId": 5, "endTime": "2026-07-01T18:00:00.000Z" }
}
```

#### Resiliência: desconexão agente ↔ API

O provisionamento é **declarativo e sem fila**: a API **não armazena ordens pendentes** para aplicar quando o agente voltar. Cada `POST /heartbeat` bem-sucedido recalcula o array `provisioning[]` com base no **relógio UTC atual**, nas alocações no banco e em `machine_users.access_type`. O agente trata essa lista como verdade absoluta no SO (ver `apps/agent/MODULE.md`).

| Camada | O que persiste | O que evolui sem heartbeat |
|--------|----------------|---------------------------|
| **API (SQLite)** | Alocações, `machine_users`, políticas | Fases de acesso (`resolveAccessPhase`), auto-finalize, `lifecycleStatus` no front — tudo por **relógio** |
| **Agente (Linux)** | Contas `lab.*`, shells, `authorized_keys` | **Nada** — só muda após heartbeat **200** |

**Máquina do agente cai (SO desligado, `agentd` parado, rede local quebrada):**

- `lastSeenAt` deixa de atualizar; após **10 min** o scheduler pode notificar admin (`LAB_NOTIF_AGENT_OFFLINE_*`); após **24 h** o status efetivo vira `offline` (`MACHINE_HEARTBEAT_OFFLINE_HOURS`) e **novas** reservas são bloqueadas.
- Alocações `approved`/`finished` **não travam** no banco: o scheduler segue finalizando vencidas; fases (`grace`, `post_sftp`, `no_key`, `teardown`) avançam pelo tempo mesmo sem agente.
- Linhas em `machine_users` **permanecem** até o próximo heartbeat reconciliar (drift só roda quando o agente reporta `provisionedOsUsers`).
- Quando o agente volta, o **primeiro** heartbeat já recebe o estado desejado **atual** — pode revogar chaves, mudar shells ou pedir `userdel` de uma só vez, conforme o que o relógio já passou durante a queda.

**API cai (agente isolado, mas SO no ar):**

- O agente continua tentando heartbeat a cada **30 s**; em falha de rede/timeout **não** chama `apply_provisioning` — o Linux **congela no último estado aplicado com sucesso**.
- Telemetria também falha; o agente mantém perfil **eco** local (`GET /api/config` no boot ou fallback em memória).
- Não há “replay” de comandos: ao restabelecer a API, um único heartbeat sincroniza o SO com a política vigente naquele instante.

**Dessincronia típica durante outage:**

| Situação | Efeito |
|----------|--------|
| Usuário em `full_shell` e agente/API offline na virada de `endTime` | Pode manter bash além do grace até reconectar |
| Fase `active` e conta nunca criada (queda antes do 1º sync) | Calendário mostra reserva ativa, mas SSH falha até heartbeat OK |
| Fase já `no_key`/`teardown` na API, agente offline | Conta/chave podem permanecer no SO até o próximo sync |
| `access_type` fixo (`shell`/`sftp`/`revoked`) em `machine_users` | API recalcula override a cada heartbeat; agente só aplica quando online |

**Resumo:** a API guarda **dados e política temporal** (alocações, inventário, fases calculadas); o agente guarda **efeito no SO**. Nenhum dos dois mantém uma ACL incremental — só o último snapshot completo em `provisioning[]`. Acesso real = interseção do relógio da API com o último sync bem-sucedido no Linux.

**Config global (admin):** `GET`/`PUT /api/v1/lab/telemetry-presets` (fast/eco) e `GET`/`PUT /api/v1/lab/settings` (aprovação e nomes no calendário).

**Rotas ainda resumidas neste doc** (ver `start/routes.ts`): `notifications`, `GET /allocations/my`, `POST /allocations/:id/extend`, `POST /allocations/:id/finish`.

---

## Camadas (controllers × services)

```
Request HTTP
  → Middleware     (auth, admin, machine token)
  → Controller     (validação VineJS, chama service, mapeia erro → HTTP)
      → Service(s) (regras de negócio, orquestração, persistência via models)
      → Model      (entidade Lucid)
  → Response JSON
```

| Camada | Responsabilidade | Não deve |
|--------|------------------|----------|
| **Controller** | Validar input, autorizar via Bouncer, chamar service, serializar resposta | Conter regras de negócio, queries complexas, transações |
| **Policy** | Quem pode fazer o quê (dono, admin) | Regras de negócio (fase, conflito, status) |
| **Service** | Regras de domínio, orquestração, side effects | Importar `HttpContext` ou retornar status HTTP |
| **Validator** | Schema de entrada (formato, tipos) | Regras de negócio (conflito, fase, ownership) |
| **Model** | Entidade, relações, queries básicas | Orquestração de fluxos multi-entidade |

**Autorização (Bouncer):** policies em `#policies/` (`AllocationPolicy`, `NotificationPolicy`); abilities em `#abilities/main` (`isAdmin`). Controllers: `await bouncer.with(AllocationPolicy).authorize('extend', allocation)`.

**Erros de domínio:** services lançam `DomainError`; `app/exceptions/handler.ts` responde `{ code, message }` com o status HTTP adequado (sem try/catch nos controllers).

**Imports:** alias `#services/{domínio}/{módulo}` — ex.: `#services/allocation/schedule`, `#services/telemetry/buffer`.

## Estrutura interna da API

```
apps/api/
├── app/
│   ├── abilities/              # Bouncer abilities (isAdmin)
│   ├── policies/               # Bouncer policies por recurso
│   ├── controllers/            # Entrada HTTP (validação + bouncer + resposta)
│   │   ├── agent_controller.ts
│   │   ├── allocations_controller.ts
│   │   ├── auth_controller.ts
│   │   ├── machines_controller.ts
│   │   ├── machine_groups_controller.ts
│   │   ├── notifications_controller.ts
│   │   ├── ssh_attempts_controller.ts
│   │   ├── system_controller.ts
│   │   ├── utils_controller.ts
│   │   └── users_controller.ts
│   ├── middleware/           # Interceptadores (auth, bouncer, admin, machine)
│   ├── models/                 # Entidades do banco de dados
│   ├── services/               # Regras de negócio por domínio
│   │   ├── shared/
│   │   │   └── domain_error.ts
│   │   ├── allocation/         # Reservas (schedule, conflict, lifecycle, allocation_service…)
│   │   ├── agent/              # Heartbeat, sync-specs, ingestão de telemetria
│   │   ├── auth/               # Login, logout, sessão
│   │   ├── user/               # CRUD e perfil de usuários
│   │   ├── audit/              # Tentativas SSH (listagem)
│   │   ├── lab/                # Config, manutenção, runtime settings
│   │   ├── machine/            # Cache, discos, specs, api_format, machine_service…
│   │   ├── machine_group/      # CRUD de grupos de máquinas
│   │   ├── notification/       # Envio (notification_service) + caixa (inbox_service)
│   │   ├── system/             # Manutenção admin, prune, hard deletes
│   │   ├── telemetry/          # Buffers, presets, downsample, API format
│   │   └── dev/                # Seeders e utilitários de desenvolvimento
│   └── validators/             # Esquemas de validação (VineJS)
├── config/
├── database/
│   ├── migrations/
│   └── seeders/
├── start/
│   ├── routes.ts
│   └── scheduler.ts
└── tests/
```

---

## Mudanças recentes (jun/2026)

| Área | Alteração |
|------|-----------|
| Specs | `applySyncSpecsIfEmpty` — agente preenche só campos vazios; admin pode limpar para forçar novo sync |
| Disco | Coluna `total_disk_gb`; capacidade de partições via agente/telemetria; admin edita só política (`mergeAdminDiskPolicyUpdate`) |
| Telemetria | Colunas CPU/GPU nullable; processo `cpuPercent` = % do host (máx. wire 1000) |
| Agente | `disksInfo` com `totalGb`; merge de partições a cada lote; erros de POST logam corpo resumido |
| Limpeza | Removidos validators/funções mortas (`listTelemetryValidator`, `wireGbToApi`, wrappers duplicados de disco) |
