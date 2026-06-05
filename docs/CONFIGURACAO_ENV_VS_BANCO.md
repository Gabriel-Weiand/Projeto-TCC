# Configuração: variáveis de ambiente vs banco de dados

Este documento descreve o que pode ser alterado **entre execuções da API** (reinício do processo) sem migrations e **sem apagar dados**, e o que exige **mudança de schema**, **outro arquivo de banco** ou **comandos destrutivos**.

Referência principal: `apps/api/.env.example` e `apps/api/app/services/lab_config.ts`.

---

## Resumo

| Tipo | Como alterar | Migration? | Perde dados do SQLite? |
|------|----------------|------------|----------------------|
| Variáveis `LAB_*` e infra no `.env` | Editar `.env` → parar API → subir de novo | Não | Não |
| Dados operacionais (usuários, máquinas, alocações, …) | CRUD via API / seeders | Não (só se você apagar registros) | Não |
| Perfis globais fast/eco (telemetria) | `PUT /api/v1/lab/telemetry-presets` ou arquivo em `storage/` | Não | Não |
| Schema novo (colunas/tabelas) | `node ace migration:run` | Sim (aditiva) | Não, se a migration só adiciona |
| Schema recriado do zero | `node ace migration:fresh` (+ `--seed`) | Sim (destrutiva) | **Sim** |
| Outro arquivo SQLite / apagar `db.sqlite3` | Trocar path ou deletar arquivo | Não | **Sim** (dataset diferente ou vazio) |

**Regra:** trocar variável de ambiente **não** é o mesmo que rodar migration. Migrations alteram **estrutura** do banco; o `.env` altera **comportamento do processo** ao subir.

---

## Como aplicar mudanças no `.env`

1. Parar a API (processo Node / `ace serve`).
2. Editar `apps/api/.env`.
3. Iniciar a API novamente.
4. (Recomendado) Recarregar o front para reler `GET /api/config`.
5. Agentes continuam com o mesmo `MACHINE_TOKEN`; não precisam reinstalar por mudança de `LAB_*`.

O SQLite padrão do projeto fica em:

`apps/api/tmp/db.sqlite3`

(definido em `apps/api/config/database.ts`, não pelo `DB_CONNECTION` do `.env.example`).

---

## Variáveis alteráveis entre execuções (sem migration, sem apagar dados)

Todas abaixo são lidas no **boot** (módulo `lab_config` ou serviços associados). Mudança exige **restart da API**.

### Infraestrutura e servidor

| Variável | Efeito | Observação |
|----------|--------|------------|
| `TZ` | Fuso do laboratório (calendário, notificações, `labNow()`) | Não apaga dados; pode mudar interpretação de “hoje” e textos locais |
| `PORT` | Porta HTTP | |
| `HOST` | Host de bind | |
| `LOG_LEVEL` | Verbosidade de log | |
| `NODE_ENV` | Modo development/production/test | |
| `DB_CONNECTION` | Documentada no exemplo | Hoje o `config/database.ts` usa conexão `sqlite` fixa em `tmp/db.sqlite3`; alterar só esta linha no `.env` **não** muda o arquivo do banco sem mudar o código |

### Autenticação

| Variável | Efeito | Observação |
|----------|--------|------------|
| `LAB_AUTH_TOKEN_EXPIRES_IN` | Validade de **novos** tokens (ex.: `6 hours`) | Tokens já emitidos seguem a regra vigente na criação; não apaga usuários |

### Calendário (exposto em `GET /api/config`)

| Variável | Efeito |
|----------|--------|
| `LAB_CALENDAR_PAST_DAYS` | Janela de passado no dashboard |
| `LAB_CALENDAR_FUTURE_DAYS_OPTIONS` | Opções do seletor (lista separada por vírgula) |
| `LAB_CALENDAR_DEFAULT_FUTURE_DAYS` | Valor inicial do seletor |

### Reservas / alocações (exposto em `GET /api/config`)

| Variável | Efeito | Comportamento em dados existentes |
|----------|--------|-----------------------------------|
| `LAB_ALLOCATION_PUBLIC_NAMES` | Quem vê nome do responsável no calendário | Só muda **resposta da API**; nada gravado por flag |
| `LAB_ALLOCATION_MAX_FUTURE_DAYS` | Limite de data fim de novas reservas | Não altera alocações já criadas |
| `LAB_ALLOCATION_MIN_DURATION_MINUTES` | Duração mínima de novas reservas | Idem |
| `LAB_ALLOCATION_GRACE_MINUTES` | Grace pós-`endTime`, gap entre reservas, fases no agente | Alocações **ativas** passam a usar o novo valor no heartbeat / conflitos |
| `LAB_ALLOCATION_POST_SFTP_MINUTES` | Janela SFTP com chave após sessão | Idem (fases calculadas em runtime) |
| `LAB_ALLOCATION_DELETE_USER_DAYS` | Quando usuário Linux sai do `provisioning` | Idem |
| `LAB_ALLOCATION_PREPARE_MINUTES` | Provisionamento T-N antes do início | Idem |
| `LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL` | Novas reservas `pending` vs `approved` | **Só novas** reservas; status antigo permanece no banco. Admin pode alterar em runtime via `PUT /api/v1/lab/settings` |
| `LAB_ALLOCATION_PUBLIC_NAMES` | Nomes no calendário para usuários | Só afeta respostas da API. Admin pode alterar em runtime via `PUT /api/v1/lab/settings` |
| `LAB_SCHEDULE_START_HOUR` | Faixa horária local permitida (início) | Validação de **novas** reservas |
| `LAB_SCHEDULE_END_HOUR` | Faixa horária local permitida (fim) | Idem |

### Telemetria global (perfis fast / eco)

| Variável | Efeito |
|----------|--------|
| `LAB_TELEMETRY_FAST` | JSON parcial; merge sobre defaults |
| `LAB_TELEMETRY_ECO` | JSON parcial; merge sobre defaults |

Ordem efetiva: **defaults do código** → **env** → **`storage/lab/telemetry_presets.json`** (se existir, sobrescreve env).

Alterar env **não** apaga telemetria nem máquinas no banco. Admin também pode persistir via `PUT /api/v1/lab/telemetry-presets` (arquivo em `storage/`, não migration).

### Manutenção (retenção e resumo)

| Variável | Efeito |
|----------|--------|
| `LAB_SUMMARIZE_AFTER_HOURS` | Horas após `endTime` para gerar `allocation_metrics` (resumo TWA) |
| `LAB_PRUNE_ALLOCATION_DAYS` | Dias após `endTime` para remover alocações terminais (`finished`, `cancelled`, `denied`); telemetria e métrica em CASCADE |
| `LAB_PRUNE_NOTIFICATION_DAYS` | Dias após `createdAt` para remover notificações |
| `LAB_PRUNE_SSH_ATTEMPTS_DAYS` | Dias de retenção de tentativas SSH (remove registros mais antigos) |

### Schedulers (cron)

| Variável | Efeito |
|----------|--------|
| `LAB_SCHEDULER_MAINTENANCE_CRON` | Manutenção sistemática: tokens expirados, resumo TWA, prune de alocações/notificações/SSH |
| `LAB_SCHEDULER_AUTO_FINALIZE_CRON` | Finalização automática de alocações vencidas + lembretes e alertas |

Requer restart para reagendar expressões.

### Notificações

| Variável | Efeito |
|----------|--------|
| `LAB_NOTIF_UPCOMING_MINUTES` | Lembrete antes do início |
| `LAB_NOTIF_SSH_KEY_MINUTES` | Lembrete de chave SSH |
| `LAB_NOTIF_SSH_FLOOD_WINDOW_MINUTES` | Janela de falhas SSH |
| `LAB_NOTIF_SSH_FLOOD_THRESHOLD` | Limiar de flood |
| `LAB_NOTIF_SSH_FLOOD_COOLDOWN_HOURS` | Cooldown alerta admin |
| `LAB_NOTIF_AGENT_OFFLINE_MINUTES` | Sem heartbeat → alerta |
| `LAB_NOTIF_AGENT_OFFLINE_COOLDOWN_HOURS` | Cooldown alerta offline |

Notificações já gravadas na tabela `notifications` **permanecem**; mudam apenas regras **futuras**.

---

## Variáveis com efeito colateral (ainda sem migration)

Não apagam o SQLite, mas vale planejar o momento da troca:

| Variável | Efeito colateral |
|----------|------------------|
| `APP_KEY` | **Invalida sessões**: tokens de usuário deixam de validar; todos precisam logar de novo. Dados no banco intactos. |
| `TZ` | Mesmos instantes UTC no banco; UI e schedulers usam outro fuso. |
| `LAB_ALLOCATION_*` (grace, SFTP, prepare, deleteUserDays) | Fases de acesso do **agente** recalculadas com valores **atuais**; pode divergir do que o usuário “viu” ao reservar com outra política. |
| `LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL` | Reservas antigas mantêm `status`; só o fluxo de **criação** muda. |

---

## O que não se altera só com `.env` (dados e estrutura)

### Persistido no banco (CRUD admin / usuário)

Alteração via API ou seeders — **não** via `.env`:

- Usuários (`users`)
- Máquinas (`machines`), tokens de agente, presets **por máquina**
- Grupos de máquinas (`machine_groups`)
- Alocações (`allocations`) e status
- Telemetria histórica (`telemetries`), métricas de sessão (`allocation_metrics`)
- Notificações (`notifications`)
- Tentativas SSH (`ssh_connection_attempts`)
- Usuários provisionados (`machine_users`)

Isso é o escopo normal do **admin no MVP** (tabelas), não “configuração de sistema” no front.

### Arquivo fora do `.env` (sem migration)

| Recurso | Caminho / rota | Notas |
|---------|----------------|-------|
| Perfis fast/eco | `apps/api/storage/lab/telemetry_presets.json` | Gitignored; sobrevive restart; pode divergir do env até você alinhar ou apagar o arquivo |
| Aprovação obrigatória / nomes públicos | `apps/api/storage/lab/runtime_settings.json` | Gitignored; `PUT /api/v1/lab/settings`; sobrescreve env até apagar o arquivo |
| Banco SQLite | `apps/api/tmp/db.sqlite3` | Apagar ou trocar de path = outro dataset (vazio ou backup) |

### Front (projeto web)

| Variável | Onde | Efeito |
|----------|------|--------|
| `VITE_API_URL` | `apps/web/.env` | URL da API; rebuild/restart do `npm run dev` |

Não afeta schema da API.

---

## Quando migrations entram (e quando há perda de dados)

### `node ace migration:run`

- Aplica migrations **pendentes** (novas tabelas/colunas/índices).
- **Não** apaga dados se as migrations forem **aditivas** (padrão do projeto).
- **Não** substitui editar `.env`.

### `node ace migration:fresh` (e `fresh --seed`)

- **Dropa e recria** todas as tabelas.
- **Apaga todos os dados** do banco atual.
- Usar só em desenvolvimento ou quando aceitar reset total.

### Editar migration **já aplicada** em ambiente com dados

- Pode exigir `fresh` ou correção manual → risco de **perda** ou inconsistência.
- Política recomendada: **nova** migration para mudança de schema; não reescrever migrations antigas em produção.

### Lista de migrations do projeto (schema)

Arquivos em `apps/api/database/migrations/`:

- `users`, `access_tokens`
- `machine_groups`, `machines`
- `allocations`, `telemetries`, `allocation_metrics`
- `notifications`, `ssh_connection_attempts`, `machine_users`

Qualquer mudança de coluna/tipo/relação nova → **nova migration**, não variável de ambiente.

---

## Mapa mental (MVP)

```
┌─────────────────────────────────────────────────────────────┐
│  .env (LAB_*, TZ, schedulers, notificações)                 │
│  → restart da API → mesmo db.sqlite3 → dados intactos       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SQLite (CRUD)                                              │
│  → usuários, máquinas, grupos, alocações, telemetria…      │
│  → admin via API; sem migration se só INSERT/UPDATE/DELETE  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  storage/lab/telemetry_presets.json                         │
│  → telemetria global fast/eco; PUT admin ou env + arquivo  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  migration:run  = estrutura nova, dados mantidos (aditivo)  │
│  migration:fresh = apaga tudo e recria                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Exemplo: `LAB_ALLOCATION_PUBLIC_NAMES`

```env
# apps/api/.env
LAB_ALLOCATION_PUBLIC_NAMES=true
```

1. Parar a API.
2. Salvar o `.env`.
3. Subir a API.
4. Confirmar: `GET /api/config` → `allocation.publicNames: true`.
5. Banco inalterado; alocações existentes continuam; o calendário passa a expor nomes conforme a regra em `canSeeAllocationUser()` (`lab_config.ts` + `allocations_controller.ts`).

---

## Referências no código

| Assunto | Arquivo |
|---------|---------|
| Leitura de `LAB_*` | `apps/api/app/services/lab_config.ts` |
| Config pública para o front | `GET /api/config` → `labPublicConfig()` em `utils_controller.ts` |
| Telemetria global (env + arquivo) | `apps/api/app/services/telemetry_presets.ts` |
| Exemplo de variáveis | `apps/api/.env.example` |
| Caminho do SQLite | `apps/api/config/database.ts` |
| Manutenção (env + admin) | `lab_maintenance.ts`, `POST /api/v1/system/maintenance/run`, `DELETE /api/v1/system/prune/*` |

---

*Documento alinhado ao monorepo Projeto-TCC (API AdonisJS 6 + SQLite). Atualize este arquivo se novas variáveis `LAB_*` ou conexões de banco forem adicionadas.*
