# Sistema Distribuído de Gestão de Laboratórios

Monorepo do TCC (UFPel): **API** central AdonisJS, **dashboard** Vue 3 e **agente** Python (`agentd.py`) nas máquinas do laboratório. O sistema alinha **estado desejado** (reservas, políticas e specs na API) com **estado real** (usuários POSIX, chaves SSH, uso de hardware e telemetria no Linux).

---

## Sumário

1. [Objetivos](#objetivos)
2. [Arquitetura](#arquitetura)
3. [Papéis: usuário e administrador](#papéis-usuário-e-administrador)
4. [Funcionalidades por domínio](#funcionalidades-por-domínio)
5. [Specs, discos e sobreposição admin ↔ agente](#specs-discos-e-sobreposição-admin--agente)
6. [Alocação, controle de acesso e relatórios](#alocação-controle-de-acesso-e-relatórios)
7. [Telemetria e métricas](#telemetria-e-métricas)
8. [Métricas e qualidade](#métricas-e-qualidade)
9. [Documentação por módulo](#documentação-por-módulo)
10. [Tecnologias](#tecnologias)
11. [Como rodar](#como-rodar)
12. [Estrutura do repositório](#estrutura-do-repositório)
13. [Trabalhos futuros](#trabalhos-futuros)

---

## Objetivos

Substituir planilhas e acordos informais por um fluxo único:

| Objetivo | Como o sistema atende |
|----------|------------------------|
| **Reservar máquinas** com calendário, conflitos e aprovação configurável | Alocações com validação de período, gap de grace e status (`pending` / `approved`) |
| **Provisionar acesso SSH** só durante a janela da reserva | Agente reconcilia `lab.*`, chaves ed25519 e fases `full_shell` → grace → `sftp_only` |
| **Medir uso real** (CPU, GPU, RAM, disco, processos) | Telemetria em lote + resumo TWA por sessão + gráficos para usuário e admin |
| **Operar o parque** (specs, discos, telemetria, manutenção) | Painel admin com edição de hardware, política de volumes, presets globais e prune |
| **Auditar segurança** | Tentativas SSH agregadas no heartbeat; alertas de flood para admin |

**Papéis:** `user` (aluno/pesquisador) e `admin` — não há cadastro público; contas são criadas pelo admin.

---

## Arquitetura

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Web (Vue 3) │────▶│ API AdonisJS │◀────│  Agente (agentd.py)  │
│  :5173       │     │  :3333       │     │  heartbeat ~30s      │
└──────────────┘     └──────┬───────┘     └──────────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ SQLite       │
                     │ tmp/db.sqlite3│
                     └──────────────┘
```

| Componente | Autenticação | Responsabilidade |
|------------|--------------|------------------|
| **Web** | Bearer token de usuário | Reservas, calendário Gantt, perfil, SSH, admin |
| **API** | Tokens de usuário + agent keys (512 bits) | Regras de negócio, notificações, telemetria, manutenção |
| **Agente** | `MACHINE_TOKEN` | `useradd`/chaves SSH, fases de acesso, métricas, sync de specs |

O agente **não** bloqueia login gráfico — o controle de acesso é via **SSH** (shell na sessão, SFTP pós-sessão, revogação de chave).

Documentação detalhada: [`apps/api/MODULE.md`](apps/api/MODULE.md), [`apps/web/MODULE.md`](apps/web/MODULE.md), [`apps/agent/MODULE.md`](apps/agent/MODULE.md).

---

## Papéis: usuário e administrador

### Usuário (`user`)

- Calendário **Gantt** multi-máquina; nova reserva com motivo, disco de home (quando permitido) e validações de horário no fuso do lab.
- **Minhas alocações:** cancelar (antes do início), finalizar antecipadamente, estender fim, **conectar SSH**, ver **estatísticas e gráficos TWA** da sessão, ocultar do histórico.
- **Parque:** listagem por grupo, busca, modal de specs; detalhe da máquina com hardware e atalho para reservar.
- **Perfil:** nome, e-mail, senha; chave SSH **ed25519** obrigatória para reservas.
- **Notificações** in-app (aprovação, lembretes, chave ausente, resumo disponível).

### Administrador (`admin`)

- **Usuários:** CRUD; `system_username` imutável; ver alocações por usuário.
- **Máquinas:** CRUD, grupos, status efetivo (online/offline/ocupada/manutenção), **edição de specs** (CPU, GPU, RAM, VRAM, disco total, IP local/alternativo), **política de discos** (principal / reservável), preset de telemetria por máquina, token do agente, descomissionamento em duas fases, usuários provisionados (override shell/sftp).
- **Detalhe ao vivo:** telemetria streaming, gráficos 24 h ocioso, **tabela de processos** com filtro Todos / Usuário lab. / Sistema, sessões ativas, partições com uso em tempo real.
- **Alocações:** listagem global, filtros por sub-estado (ativa, grace, SFTP…), aprovar/negar/cancelar, editar período, **gerar resumo TWA**, reservar em nome de outro usuário.
- **Manutenção** (`/admin/maintenance`): presets globais fast/eco, políticas do lab (aprovação, grace, SFTP, nomes no Gantt), retenção e prune manual.

---

## Funcionalidades por domínio

### Autenticação e perfil

- Login/logout; tokens Adonis (hash SHA-256); login invalida sessões anteriores.
- Sincronização de relógio web ↔ API (`GET /api/time`) para validação de horários.

### Reservas

- Validações: ordem início/fim, duração mínima, limite futuro, passado, conflito com gap de grace (`LAB_ALLOCATION_GRACE_MINUTES`, padrão **10 min**).
- Aprovação automática ou pendente (`LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL`).
- Fases operacionais: preparação → sessão (`full_shell`) → grace → SFTP (`sftp_only`) → teardown.

### Notificações

- Inbox: lembrete de reserva, chave SSH ausente, aprovação/negativa, agente offline, flood SSH (admin), resumo de sessão disponível.

### Agente

- **3 threads:** heartbeat (30 s), telemetria (preset da API), auditoria SSH.
- Bootstrap: `GET /api/config` → `PUT sync-specs` → loops.
- Provisionamento declarativo, drift `lab.*`, telemetria em lote, processos on-demand.

---

## Specs, discos e sobreposição admin ↔ agente

Hardware estável da máquina é dividido em **colunas de spec** e **partições JSON**. Admin e agente têm papéis distintos; o sync **não sobrescreve** o que o admin já definiu.

### Colunas de spec (`machines`)

| Campo | Quem preenche | Regra de merge no `sync-specs` |
|-------|---------------|--------------------------------|
| `cpuModel`, `gpuModel` | Admin **ou** agente (boot) | Agente só grava se vazio (`null` ou string em branco) |
| `totalRamGb`, `totalVramGb`, `totalDiskGb` | Idem | Wire **GB×10** no DB; API/front em GB decimal; agente só preenche se ≤ 0 |
| `ipAddress` | Agente (detectado) ou admin | **IP local** — agente preenche se vazio; admin pode editar/limpar |
| `publicIpAddress` | **Somente admin** | IP alternativo (NAT/DNS); agente **não** envia |
| `hostFingerprint` | Agente | Preenche se vazio (chave host ed25519) |

**Limpar um campo no painel admin** (ex.: CPU em branco) **reabilita** o próximo `sync-specs` do agente a repreencher.

Serviço: `applySyncSpecsIfEmpty` em `#services/machine_specs_merge.ts`.

### Partições (`machines.disks[]`)

| Dado | Fonte | Observação |
|------|--------|------------|
| `totalGb`, `freeGb`, `usagePct` | Agente (`sync-specs` + telemetria `disksInfo`) | Atualizados continuamente; admin **não** edita capacidade |
| `mainDisk`, `allocatable`, `onlyMainDisk` | **Admin** | Política de reserva — qual volume é principal e aparece no picker |
| `role` (`system` / `user`) | Heurística + preservação | Mounts de boot/EFI = sistema; `/`, `/data` = usuário |

Telemetria: última amostra do lote com `disksInfo` atualiza capacidade via `mergeDiskPartitionsFromTelemetry`.

**Exibição no front:** `totalDiskGb` da spec tem prioridade; se ausente, soma `totalGb` das partições (`displayTotalDiskGb`).

---

## Alocação, controle de acesso e relatórios

### Ciclo da reserva (visão integrada)

```
pending → approved → [prepare] → active (full_shell) → grace → sftp_only → teardown → finished
```

| Fase | Usuário vê | Agente aplica | Telemetria API |
|------|------------|---------------|----------------|
| Antes do início | Reserva no Gantt; pode cancelar | Sem conta ou preparação | Eco (máquina ociosa) |
| Sessão ativa | Botão **Conectar SSH**; modal com comando | `full_shell` + chave ed25519 | **Fast** + amostras brutas em `telemetries` |
| Grace / SFTP | Ainda conectável (SFTP) | `sftp_only`; `pkill` na transição | Fast até teardown |
| Após fim | Histórico; **estatísticas da sessão** se admin gerou resumo | Remoção gradual (`userdel`) | Raw purgada; fica `allocation_metrics` |

### O que o usuário recebe como “relatório”

- Modal **Estatísticas de uso** (`AllocationUsageStatsModal`): médias/máximas TWA (CPU, GPU, RAM, VRAM, swap, temperaturas, I/O, rede), duração da sessão, gráficos por abas (CPU, GPU, RAM, disco…).
- Disponível após admin (ou fluxo automático) chamar `POST /allocations/:id/summary` — notificação *“Resumo da sessão disponível”*.

### O que o admin regula

- **Presets** fast/eco em `/admin/maintenance?tab=telemetria` (redirect legado de `/admin/lab-telemetry`).
- **Custom por máquina** em `AdminMachineEditView` / `MachineTelemetryPanel` (intervalo, batch, toggles de métricas, captura de processos).
- **Políticas** grace, SFTP pós-sessão, dias até `userdel`, aprovação obrigatória — `.env` + overrides runtime.

---

## Telemetria e métricas

### Onde ficam os dados

| Contexto | Armazenamento | Uso principal |
|----------|---------------|---------------|
| **Tempo real** (CPU, RAM, GPU, discos, processos) | RAM — `telemetryBuffer` | Painel admin, parque, stream; **sempre** atualizado pelo agente |
| **Gráfico 24 h ocioso** | RAM — `idleTelemetryBuffer` | Sempre (ocioso **e** alocação); ~96 pts @ 15 min |
| **Sessão em curso** | SQLite — `telemetries` | Flush a cada 60 s; base para resumo TWA; **não** alimenta UI ao vivo |
| **Após resumo** | `allocation_metrics.chart_series` | Modal de estatísticas do usuário/admin |

### Durante alocação vs ocioso

- **Monitoramento ao vivo** (barras, processos, partições): lê **`GET /machines/:id/telemetry/stream`** → buffer runtime (`telemetryBuffer`), **não** o banco.
- **Gráfico 24 h** no detalhe admin: lê **`idleHistory.chartSeries`** — série **@ 15 min** materializada em RAM (`pendingBucket` + `chartSeries`).
- **Persistência da sessão** corre em paralelo (`telemetries`) para `POST /allocations/:id/summary` e purge posterior.

### Memória por máquina ociosa (dois buffers)

Máquina **sem alocação ativa** usa **apenas** estes dois buffers em RAM (além do SQLite, que fica vazio ocioso):

| Buffer | O quê guarda | Capacidade |
|--------|----------------|------------|
| **`telemetryBuffer`** | Amostras **ricas** do agente (barras, processos, discos, usuários) | ~15–31 amostras (ring + último lote) |
| **`idleTelemetryBuffer`** | (1) janela **aberta** de 15 min com amostras na precisão do agente; (2) **~96 pontos** @ 15 min já fechados (24 h) | ≤15 amostras pendentes + 96 pts gráfico |

**Ciclo do gráfico ocioso:** cada amostra do agente entra na janela de 15 min corrente. Quando a janela fecha, faz-se **TWA** sobre essas amostras → **um** ponto @ 15 min entra em `chartSeries`; as amostras brutas da janela são **descartadas**. Pontos &gt; 24 h saem do rolling. O `GET …/telemetry` **não recalcula** — devolve `chartSeries` pronto (+ preview da janela aberta).

### RAM estimada — 1 máquina, 24 h ociosas (regime estável)

Presets eco: intervalo **60 s**, lote **15** → 96 POSTs/dia, 1 440 amostras/dia processadas; **96 pontos** persistidos no gráfico. Estimativa: payload JSON + ~×1,8 overhead V8 (ordem de grandeza).

| Preset | `telemetryBuffer` | idle pending (≤15) | idle `chartSeries` (~96) | **Total ocioso** |
|--------|-------------------|--------------------|---------------------------|------------------|
| **Eco atual** (cpu, ram, disco, users; sem gpu/rede/temp/proc) | ~35 KiB | ~17 KiB | ~30 KiB | **~81 KiB** |
| **Eco full − processos** (gpu, rede, temp, users, disco; sem proc) | ~42 KiB | ~20 KiB | ~53 KiB | **~116 KiB** |

Detalhes de implementação: [`apps/api/MODULE.md`](apps/api/MODULE.md#retenção-e-buffers).

**Métricas desligadas no preset** → campo `null` na amostra (não confundir com 0). UI exibe `—`.

**Processos:** `cpuPercent` no wire = % da **capacidade total do host** (psutil normalizado ÷ CPUs lógicas). Filtro no front admin: contas `lab.*` vs sistema. Com `processCaptureConfig.userScope: session` (preset ou custom), o agente **só** envia processos enquanto houver `lab.*` conectado; máquina ociosa ou só contas de sistema → amostra sem `processes` (tabela vazia no admin).

Detalhes de buffers, roteamento no agente e endpoints: [`apps/api/MODULE.md`](apps/api/MODULE.md#retenção-e-buffers).

---

## Métricas e qualidade

_Medições em junho/2026 (excl. `node_modules` / venv)._

| Métrica | Agente | API | Web |
|---------|--------|-----|-----|
| Linhas principais | ~1 350 (`agentd.py`) | ~16 000 TS | ~18 000 Vue/TS |
| Testes automatizados | — (contrato via API) | **231** specs Japa | Scripts Node (`datetime`, `ssh`, `notificationMessage`) |
| Documentação | `MODULE.md` | `MODULE.md` | `MODULE.md` |

### Pontos de atenção (revisão de código)

**Agente:** lotes de telemetria sem retry local se POST falhar; log SSH fixo em `/var/log/auth.log`.

**API:** buffers de telemetria só em memória (não multi-instância); CORS permissivo; token de agente em texto no SQLite.

**Web:** `VITE_API_URL` default `:7372` no código — usar `.env` com porta da API; falhas de fetch às vezes viram lista vazia; `alert()`/`confirm()` em fluxos admin.

---

## Documentação por módulo

| Módulo | Conteúdo principal | Arquivo |
|--------|-------------------|---------|
| **API** | Rotas, ER, TWA, specs merge, discos, alocações, agente | [`apps/api/MODULE.md`](apps/api/MODULE.md) |
| **Web** | Rotas, stores, fluxos user/admin, componentes ao vivo | [`apps/web/MODULE.md`](apps/web/MODULE.md) |
| **Agente** | Heartbeat, sync-specs, telemetria, provisionamento, GPU | [`apps/agent/MODULE.md`](apps/agent/MODULE.md) |

A pasta `docs/` mantém a proposta em PDF. Conteúdo técnico está nos `MODULE.md` de cada app.

---

## Tecnologias

| Camada | Stack |
|--------|--------|
| API | Node.js **22.x**, AdonisJS 6, TypeScript, Lucid, VineJS, SQLite |
| Web | Vue 3, Vite, Pinia, Vue Router, Axios, Chart.js |
| Agente | Python 3, `psutil`, `requests`, `nvidia-ml-py` (opcional) |

---

## Como rodar

### Pré-requisitos

- **Node.js 22.x**
- npm
- Python 3 (agente nas máquinas)

### API

```bash
cd apps/api
npm install
cp .env.example .env
node ace migration:run
# Banco + dados de teste (perfil dev):
node ace seed:fresh dev
# ou: npm run seed:dev
# outros perfis: npm run seed:minimal | npm run seed:lab
# alternativa: LAB_SEED_PROFILE=dev node ace migration:fresh --seed
node ace serve --watch
```

Testes: `node ace test` (231 specs).

Utilitários web: `node apps/web/src/utils/datetime.spec.mjs`

### Web

```bash
cd apps/web
npm install
echo "VITE_API_URL=http://localhost:3333" > .env
npm run dev
```

Credenciais de seed: [`apps/web/README.md`](apps/web/README.md).

### Agente

Ver [`apps/agent/MODULE.md`](apps/agent/MODULE.md) — `MACHINE_TOKEN`, `SERVER_URL`, systemd.

---

## Estrutura do repositório

```
Projeto-TCC/
├── apps/
│   ├── api/          # Backend AdonisJS
│   ├── web/          # Frontend Vue 3
│   └── agent/        # Daemon Python (agentd.py)
├── docs/             # Proposta TCC (PDF)
└── README.md
```

---

## Trabalhos futuros

- Integração LDAP/AD; notificações e-mail/push
- WebSocket para status (hoje: polling + stream de telemetria)
- Testes E2E web; testes unitários do agente
- Rate limiting, paginação em `/users`, horário comercial (`LAB_SCHEDULE_*`)
- Retry de telemetria no agente; mensagens de erro consistentes no front

---

## Licença

Projeto acadêmico — TCC UFPel.

_Documento atualizado em junho de 2026._
