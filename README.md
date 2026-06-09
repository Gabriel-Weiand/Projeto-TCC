# Sistema Distribuído de Gestão de Laboratórios

Monorepo do TCC (UFPel): API central AdonisJS, dashboard Vue 3 e agente Python (`agentd.py`) nas máquinas do laboratório. O sistema alinha **estado desejado** (reservas na API) com **estado real** (usuários POSIX, chaves SSH e telemetria no Linux).

---

## Sumário

1. [Contexto](#contexto)
2. [Arquitetura](#arquitetura)
3. [Funcionalidades](#funcionalidades)
4. [Métricas e qualidade](#métricas-e-qualidade)
5. [Status e documentação](#status-e-documentação)
6. [Tecnologias](#tecnologias)
7. [Como rodar](#como-rodar)
8. [Estrutura do repositório](#estrutura-do-repositório)
9. [Trabalhos futuros](#trabalhos-futuros)

---

## Contexto

Laboratórios de pesquisa costumam gerir máquinas com planilhas e acordos informais. Este sistema centraliza reservas, provisionamento SSH por alocação, telemetria de uso e painel administrativo.

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
| **Agente** | `MACHINE_TOKEN` | `useradd`/chaves SSH, fases `full_shell`/`sftp_only`, métricas |

O agente **não** bloqueia tela de login gráfico — o controle de acesso é via **SSH** (shell completo na sessão, SFTP pós-sessão, revogação de chave).

Documentação detalhada: [`apps/api/MODULE.md`](apps/api/MODULE.md), [`apps/web/MODULE.md`](apps/web/MODULE.md), [`apps/agent/MODULE.md`](apps/agent/MODULE.md).

---

## Funcionalidades

### Autenticação e perfil

- Login/logout (`POST /api/v1/login`, `DELETE /api/v1/logout`); tokens Adonis (hash SHA-256 no banco)
- Login invalida sessões anteriores do mesmo usuário
- Perfil: nome, e-mail, senha; chave SSH **ed25519** obrigatória para reservas
- Sincronização de relógio web ↔ API (`GET /api/time`) para validação de horários no fuso do lab

### Reservas (usuário)

- Calendário **Gantt** multi-máquina com janela configurável (dias passados/futuros via `GET /api/config`)
- Nova reserva: data/hora início e fim no fuso do laboratório, motivo opcional, escolha de volume/disco quando a máquina permite
- Validações: ordem início/fim, duração mínima, limite futuro, **horário no passado**, conflito com gap de grace (`LAB_ALLOCATION_GRACE_MINUTES`, padrão **10 min**)
- Aprovação automática ou pendente (`LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL`)
- **Minhas alocações:** cancelar (antes do início), finalizar antecipadamente, estender fim, conectar SSH, estatísticas TWA da sessão, ocultar do histórico
- Fases operacionais: preparação → sessão (`full_shell`) → grace → SFTP (`sftp_only`) → teardown

### Parque de máquinas (usuário)

- Listagem agrupada por laboratório/grupo, busca e modal de specs
- Detalhe: hardware, fingerprint SSH, atalho para reservar, botão conectar quando a sessão está ativa

### Notificações

- Inbox in-app: lembrete de reserva, chave SSH ausente, aprovação/negativa, agente offline, flood SSH (admin)
- Marcar lida / marcar todas; scheduler na API dispara lembretes

### Administradores — usuários

- CRUD de contas (`user` / `admin`); `system_username` imutável após criação
- Visualizar alocações por usuário

### Administradores — máquinas

- CRUD, status efetivo (online/offline por heartbeat, manutenção, ocupada)
- Specs sincronizadas pelo agente (`PUT /api/v1/agent/sync-specs`): CPU, RAM, VRAM, GPU, discos JSON
- Política de discos: `only_main_disk`, mountpoints alocáveis, `home_mountpoint` por reserva
- Grupos de máquinas (laboratórios)
- Preset de telemetria por máquina (fast/eco) + overrides globais em `/admin/maintenance`
- Token do agente (512 bits), rotação, descomissionamento em duas fases (202 → agente limpa `lab.*` → 204)
- **Usuários provisionados:** override manual de acesso (`shell` / `sftp` / `auto`) por máquina
- Telemetria ao vivo (buffer SSE/polling), histórico ocioso 24 h, solicitar snapshot de processos pesados
- Auditoria SSH por máquina (`/var/log/auth.log` via agente)

### Administradores — alocações

- Listagem global com filtros por status/sub-estado (ativa, grace, SFTP, pendente, etc.)
- Aprovar/negar/cancelar; editar início/fim (overlay com Gantt); gerar resumo TWA; exclusão definitiva
- Reservar em nome de outro usuário (Home + picker)

### Administradores — manutenção (`/admin/maintenance`)

- Presets de telemetria (intervalo, batch, métricas on/off)
- Políticas do lab: aprovação obrigatória, nomes públicos no Gantt, grace/SFTP/prepare
- Retenção: resumir telemetria, podar alocações/notificações/tentativas SSH
- Execução manual de jobs de manutenção e prune

### Agente (`agentd.py`)

- **3 threads:** heartbeat (30 s), telemetria (preset da API), auditoria SSH
- Bootstrap: `GET /api/config` → `PUT sync-specs` → loop
- **Provisioning declarativo:** `useradd`/`usermod`, chaves ed25519, shell vs SFTP, migração de `$HOME` opcional
- Reconciliação de drift (usuários/dirs `lab.*` órfãos), descomissionamento multi-partição
- Telemetria em lote: CPU, RAM, swap, GPU (NVML/AMD/Intel), discos, rede, temperatura, processos on-demand
- Resiliência: só aplica OS changes em heartbeat **200**; token inválido não apaga usuários

### Telemetria e métricas (API)

- Amostras brutas ligadas à **alocação ativa**; buffer em memória para tempo real
- Buffer ocioso 24 h quando não há alocação
- Resumo **TWA** por sessão → `allocation_metrics` + série para gráficos; purge de raw após resumo
- Downsample e normalização para front/admin

### Configuração

- Políticas via `.env` (`LAB_*`) + overrides runtime (`PUT /api/v1/lab/settings`, JSON em `storage/lab/`)
- Calendário, limites, fuso e políticas de alocação expostos em `GET /api/config`

---

## Métricas e qualidade

_Medições em junho/2026 (excl. `node_modules` / venv)._

| Métrica | Agente | API | Web |
|---------|--------|-----|-----|
| Linhas de código (approx.) | ~1 230 (`agentd.py`) | ~16 000 TS | ~18 000 Vue/TS |
| Arquivos fonte principais | 1 daemon + docs | 12 controllers, 25 services, 10 migrations, 9 models | 13 views, 31 components, 8 stores |
| Testes automatizados | — (contrato via API) | **205** specs Japa | 3 scripts Node (`datetime`, `ssh`, `notificationMessage`) |
| Documentação | `MODULE.md` (~875 linhas) | `MODULE.md` | `MODULE.md` |

**Histórico git:** ~59 commits; ~326 k linhas adicionadas / ~284 k removidas (inclui refactors de documentação).

### Revisão de código — pontos de atenção

**Agente**
- Possível crash na thread de telemetria com preset eco (`gpuUsage` nulo no log) — `agentd.py` ~1120
- Lotes de telemetria descartados se o POST falhar (sem retry)
- Sem testes unitários do daemon; log SSH fixo em `/var/log/auth.log` (Debian/Ubuntu)

**API**
- Filtro `lifecycleStatus` carrega todas as alocações em memória antes de paginar
- `GET /users` sem paginação (documentado no MODULE, não implementado)
- CORS permissivo (`origin: true`); sem rate limit no login
- Token de agente em texto plano no SQLite; buffers de telemetria só em memória (não multi-instância)

**Web**
- Default `VITE_API_URL` no código é `:7372`; documentação usa `:3333` — exige `.env`
- Falhas de fetch frequentemente viram “lista vazia” sem mensagem de erro
- Código órfão: `AdminLabTelemetryView.vue`, `AdminTabBar.vue`
- UI usa `alert()`/`confirm()` em vários fluxos admin

---

## Status e documentação

| Módulo | Estado | Documento |
|--------|--------|-----------|
| API | Implementado | [`apps/api/MODULE.md`](apps/api/MODULE.md) |
| Web | Implementado | [`apps/web/MODULE.md`](apps/web/MODULE.md) |
| Agente | Implementado | [`apps/agent/MODULE.md`](apps/agent/MODULE.md) |

A pasta `docs/` mantém apenas a proposta em PDF. Conteúdo técnico anterior foi consolidado nos `MODULE.md`.

---

## Tecnologias

| Camada | Stack |
|--------|--------|
| API | Node.js **22.x**, AdonisJS 6, TypeScript, Lucid, VineJS, SQLite (`better-sqlite3`) |
| Web | Vue 3, Vite, Pinia, Vue Router, Axios, Chart.js |
| Agente | Python 3, `psutil`, `requests`, `nvidia-ml-py` (opcional) |

---

## Como rodar

### Pré-requisitos

- **Node.js 22.x** (`node -v`) — ex.: [NodeSource setup_22.x](https://github.com/nodesource/distributions)
- npm
- Python 3 (somente para o agente nas máquinas)

O `better-sqlite3` é nativo: o `postinstall` em `apps/api` roda `npm rebuild better-sqlite3` após `npm install`.

### API

```bash
cd apps/api
npm install
cp .env.example .env
# Ajuste TZ (ex.: America/Sao_Paulo) e LAB_* — ver .env.example

node ace migration:run
# ou, em dev com schema novo: node ace migration:fresh --seed

node ace serve --watch
# ou: npm run dev
```

Testes: `node ace test` (205 specs; banco de teste em `tmp/test.sqlite3`).

Testes web (utilitários): `node apps/web/src/utils/datetime.spec.mjs` (e `ssh.spec.mjs`, `notificationMessage.spec.mjs`).

### Web

```bash
cd apps/web
npm install
echo "VITE_API_URL=http://localhost:3333" > .env
npm run dev
```

Abre em `http://localhost:5173`. Credenciais de seed: ver [`apps/web/README.md`](apps/web/README.md).

### Agente

Ver [`apps/agent/MODULE.md`](apps/agent/MODULE.md) — variáveis `MACHINE_TOKEN`, `SERVER_URL`, instalação como serviço (root, systemd).

---

## Estrutura do repositório

```
Projeto-TCC/
├── apps/
│   ├── api/          # Backend AdonisJS (~133 arquivos)
│   ├── web/          # Frontend Vue 3 (~147 arquivos)
│   └── agent/        # Daemon Python (agentd.py)
├── docs/             # Proposta TCC (PDF)
└── README.md
```

---

## Trabalhos futuros

- Integração LDAP/AD
- Notificações push / e-mail
- WebSocket para status em tempo real (hoje: polling + stream de telemetria)
- Testes E2E web; testes de integração do agente
- Rate limiting, paginação em `/users`, enforcement de horário comercial (`LAB_SCHEDULE_*`)
- Correções da revisão: retry de telemetria no agente, tratamento de erro no Gantt, remoção de código morto no front

---

## Licença

Projeto acadêmico — TCC UFPel.

_Documento atualizado em junho de 2026._
