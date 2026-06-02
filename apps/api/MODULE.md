# Módulo API

## Papel

A API centraliza regras de negócio, autenticação e persistência. Ela orquestra a comunicação entre frontend e agentes, e consolida as métricas de telemetria em dados de sessão.

## Como rodar

### Pre-requisitos

- Node.js 20+
- npm ou pnpm

### Instalacao

```bash
# Dentro do monorepo
cd apps/api

npm install

# Configurar ambiente
cp .env.example .env
# Ajuste TZ (fuso do lab) e LAB_* — calendário, limite de reserva, token, crons (ver .env.example)

# Executar as migrations
node ace migration:run

# (Opcional) Dados de teste
node ace db:seed

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
- `machines` com `agent_token`, specs (`total_ram_gb`, `total_vram_gb` em **wire GB×10**), `telemetry_preset`, `custom_agent_config`, `host_fingerprint`.
- `machine_users` — vínculo usuário ↔ máquina provisionada no SO.
- `allocations` com janela de uso e `is_sudo` (no seed dev, reservas típicas de **2–4 semanas**).
- `telemetries` — amostras brutas (wire ×10 para uso/temp; processos em JSON).
- `allocation_metrics` — TWA e picos por sessão.
- `ssh_connection_attempts` — auditoria de login SSH.
- `notifications` — caixa de entrada por usuário.

## Consolidação de telemetria

- **Média ponderada pelo tempo (TWA):**

$TWA = \frac{\sum (v_i \cdot \Delta t_i)}{T_{total}}$

- **Fallback de GPU:** dados nulos/zerados de GPU são ignorados na consolidação, sem interromper o cálculo das demais métricas.

## Observações

- `system_username` deve ser estável/imutável por regra de negócio (a constraint explícita não está no schema).
- Autenticação do agente: apenas `Authorization: Bearer <token>` (512 bits).

## Notificações (`notification_service`)

Política central em `#services/notification_service.ts`. Disparos por controller, heartbeat ou scheduler (`start/scheduler.ts`, mesmo cron do auto-finalize). Variáveis: `LAB_NOTIF_*` em `.env.example`.

### Usuário

| Título | Gatilho |
|--------|---------|
| Reserva aprovada | `pending` → `approved` |
| Reserva negada | status `denied` |
| Reserva cancelada | status `cancelled` (qualquer fluxo) |
| Reserva cancelada (manutenção) | máquina entra em `maintenance` (todas `approved`/`pending` canceladas) |
| Reserva em breve | scheduler: início em até **10 min** (`LAB_NOTIF_UPCOMING_MINUTES`) |
| Chave SSH — reserva em 5 min | scheduler: início em até **5 min**, sem `ssh_public_key` |
| Chave SSH — reserva iniciada | scheduler (sessão ativa) ou **heartbeat** (alocação corrente), sem chave |
| Sessão encerrada | auto-finalize (`finished`) |
| Resumo da sessão disponível | `POST /allocations/:id/summary` |
| Cadastre sua chave SSH | `POST /users` (criação de conta) |

Marcador `[alloc#id#]` na mensagem evita duplicata nos lembretes agendados (e `[machine#id#]` para alertas admin).

### Admin

| Título | Gatilho |
|--------|---------|
| Nova reserva pendente (sudo) | criação `pending` + `isSudo` |
| Reserva sudo negada / cancelada | `pending` → `denied` ou `cancelled` (sudo) |
| Possível flood SSH | **heartbeat** com `sshAttempts`: ≥20 falhas em 15 min (`LAB_NOTIF_SSH_FLOOD_*`), cooldown 1 h por máquina |
| Agente offline | scheduler (a cada 5 min): `lastSeenAt` ausente ou &gt; **10 min** em máquina `available`/`occupied`; **no máximo 1 alerta a cada 24 h** por máquina (`LAB_NOTIF_AGENT_OFFLINE_COOLDOWN_HOURS`) — sinal para colocar em **manutenção** ou retirar do parque, sem flood |

Flood SSH **não** roda no endpoint de telemetria — só quando o agente envia tentativas no heartbeat.

**Agente offline:** o job roda no mesmo cron do auto-finalize; a detecção é frequente, mas o cooldown de 24 h garante um lembrete diário por máquina problemática (labs remotos dependem do heartbeat).

### Manutenção de máquina

`PUT /machines/:id` com `status: maintenance` cancela **todas** as alocações `approved`/`pending` da máquina e notifica cada usuário. Resposta inclui `cancelledAllocations` quando > 0.

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
│  │ TelemetriesCtrl │                       │        Models               │  │
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
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│      USERS       │       │   ACCESS_TOKENS  │       │    MACHINES      │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (PK)          │──────<│ tokenable_id(FK) │       │ id (PK)          │
│ full_name        │       │ type             │       │ name             │
│ email (UNIQUE)   │       │ name             │       │ api_key (UNIQUE) │
│ password (HASH)  │       │ hash             │       │ cpu_model        │
│ role (enum)      │       │ abilities        │       │ ram_gb           │
│ created_at       │       │ created_at       │       │ disk_gb          │
│ updated_at       │       │ updated_at       │       │ os               │
└──────────────────┘       │ last_used_at     │       │ status (enum)    │
				 │                 │ expires_at       │       │ last_heartbeat   │
				 │                 └──────────────────┘       │ created_at       │
				 │                                            │ updated_at       │
				 │                                            └──────────────────┘
				 │                                                     │
				 │                 ┌──────────────────┐                │
				 │                 │   ALLOCATIONS    │                │
				 │                 ├──────────────────┤                │
				 └────────────────>│ user_id (FK)     │<───────────────┘
													 │ machine_id (FK)  │
													 │ starts_at        │
													 │ ends_at          │
													 │ actual_login     │
													 │ actual_logout    │
													 │ created_at       │
													 │ updated_at       │
													 └────────┬─────────┘
																		│
				 ┌──────────────────────────┴──────────────────────────┐
				 │                                                      │
				 ▼                                                      ▼
┌──────────────────┐                               ┌──────────────────────┐
│   TELEMETRIES    │                               │  ALLOCATION_METRICS  │
├──────────────────┤                               ├──────────────────────┤
│ id (PK)          │                               │ id (PK)              │
│ machine_id (FK)  │                               │ allocation_id (FK)   │
│ cpu_percent      │                               │ avg_cpu_percent      │
│ ram_percent      │                               │ avg_ram_percent      │
│ disk_percent     │                               │ avg_disk_percent     │
│ created_at       │                               │ peak_cpu_percent     │
│                  │                               │ peak_ram_percent     │
└──────────────────┘                               │ samples_count        │
																									 │ created_at           │
																									 │ updated_at           │
																									 └──────────────────────┘
```

---

## Tecnologias Utilizadas

| Tecnologia     | Versão | Propósito                            |
| -------------- | ------ | ------------------------------------ |
| **Node.js**    | 20+    | Runtime JavaScript                   |
| **AdonisJS**   | 6.x    | Framework web full-stack             |
| **TypeScript** | 5.x    | Tipagem estática                     |
| **Lucid ORM**  | -      | Mapeamento objeto-relacional         |
| **VineJS**     | -      | Validação de dados                   |
| **SQLite**     | 3.x    | Banco de dados (WAL Mode habilitado) |

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
│  Geração do Agent Key:                                      │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ const apiKey = string.generateRandom(64) // 512 bits   │ │
│  │ // Exemplo: "d08248929bf8bcae92a2e204219c7941..."      │ │
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
│                      REGRA DE 5 MINUTOS DE GAP                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Objetivo: Garantir tempo para troca de usuários entre sessões          │
│                                                                         │
│  Implementação:                                                         │
│  • Ao criar alocação, verificar conflito com gap de 5 minutos           │
│  • Alocação A (10:00-11:00) bloqueia criação de B antes de 11:05        │
│                                                                         │
│  Linha do tempo:                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 10:00      11:00  11:05      12:00                               │   │
│  │   │──────────│      │──────────│                                 │   │
│  │   │ Alocação │ GAP  │ Alocação │                                 │   │
│  │   │    A     │ 5min │    B     │                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Limite de antecedência (`LAB_MAX_ALLOCATION_DAYS_AHEAD`)

Reservas futuras não podem terminar além do horizonte configurado no `.env` (padrão em `.env.example`). Create e `POST /allocations/:id/extend` retornam `ALLOCATION_TOO_FAR` se violar. No laboratório de vídeo, alocações costumam durar **semanas** (treino CUDA, renders); o seed reflete sessões de 2–4 semanas.

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
| `status`      | enum   | ❌          | `available`, `occupied`, `maintenance`, `offline` |

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

> `latestTelemetry` vem do ring buffer (última amostra). Uso/temp em % e °C; RAM/VRAM em GB decimal.

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

Histórico de telemetria da máquina.

**Permissão:** Admin

**Query Params:**
| Param | Tipo | Padrão | Descrição |
| :---------- | :----- | :----- | :--------------------------- |
| `startDate` | ISO8601| - | Data inicial do período |
| `endDate` | ISO8601| - | Data final do período |
| `page` | number | 1 | Página atual |
| `limit` | number | 100 | Itens por página (max: 1000) |

**Response (200):**

```json
{
  "meta": { "total": 500, "perPage": 100, "currentPage": 1, "lastPage": 5 },
  "data": [
    {
      "id": 1,
      "machineId": 1,
      "cpuUsage": 850,
      "cpuTemp": 720,
      "gpuUsage": 620,
      "gpuTemp": 680,
      "ramTotalGb": 2560,
      "ramUsedGb": 1400,
      "vramTotalGb": 480,
      "vramUsedGb": 120,
      "downloadMbps": 50,
      "uploadMbps": 10,
      "timestamp": "2026-01-28T12:00:00.000Z"
    }
  ]
}
```

> 📊 **Nota:** `cpuUsage`/`gpuUsage` e temperaturas: escala ×10 (850 = 85,0%). RAM/VRAM no histórico: wire GB×10 no banco; o endpoint pode serializar em GB decimal conforme o controller.

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

Atualizar status de uma alocação.

**Permissão:** Geral (usuário só pode cancelar suas próprias alocações aprovadas)

**Request Body:**

```json
{
  "status": "cancelled"
}
```

| Campo       | Tipo    | Obrigatório | Descrição                                                |
| :---------- | :------ | :---------- | :------------------------------------------------------- |
| `status`    | enum    | ❌          | `pending`, `approved`, `denied`, `cancelled`, `finished` |
| `startTime` | ISO8601 | ❌          | Nova data/hora de início (Admin only)                    |
| `endTime`   | ISO8601 | ❌          | Nova data/hora de término (Admin only)                   |
| `reason`    | string  | ❌          | Novo motivo (Admin only)                                 |

**Response (200):** Alocação atualizada

**Erros:**

- `403` `NOT_OWNER` - Não é o dono da alocação
- `403` `INVALID_STATUS_CHANGE` - Usuário normal tentou status diferente de `cancelled`
- `403` `CANNOT_CANCEL` - Só pode cancelar alocações aprovadas
- `403` `CANNOT_CHANGE_TIME` - Usuário normal não pode alterar horários

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
  "avgCpuUsage": 450,
  "maxCpuUsage": 850,
  "avgGpuUsage": 200,
  "maxGpuUsage": 600,
  "avgRamUsage": 550,
  "maxRamUsage": 750,
  "avgCpuTemp": 650,
  "maxCpuTemp": 780,
  "avgGpuTemp": 580,
  "maxGpuTemp": 700,
  "totalDataPoints": 720,
  "sessionDurationMinutes": 240,
  "createdAt": "2026-01-28T12:00:00.000Z"
}
```

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

#### 🧹 System — exclusão pontual e prune (Admin Only)

Prefixo: `/api/v1/system`

##### `DELETE /api/v1/system/telemetries/:id`

Apagar um registro específico de telemetria.

**Permissão:** Admin

**Response (200):**

```json
{
  "message": "Telemetria removida com sucesso"
}
```

---

##### `DELETE /api/v1/system/metrics/:id`

Apagar um resumo de sessão específico.

**Permissão:** Admin

**Response (200):**

```json
{
  "message": "Métrica removida com sucesso"
}
```

---

#### 🗑️ System Prune (Admin Only)

##### `DELETE /api/v1/system/prune/telemetries`

Limpar telemetrias antigas em lote.

**Permissão:** Admin

**Request Body:**

```json
{
  "before": "2026-01-01T00:00:00Z",
  "machineId": 1
}
```

| Campo       | Tipo    | Obrigatório | Descrição                               |
| :---------- | :------ | :---------- | :-------------------------------------- |
| `before`    | ISO8601 | ✅          | Remove registros anteriores a esta data |
| `machineId` | number  | ❌          | Limitar a uma máquina específica        |

**Response (200):**

```json
{
  "message": "1500 registros de telemetria removidos",
  "deletedCount": 1500
}
```

---

##### `DELETE /api/v1/system/prune/allocations`

Limpar alocações finalizadas/canceladas antigas.

**Permissão:** Admin

**Request Body:**

```json
{
  "before": "2025-01-01T00:00:00Z",
  "status": ["finished", "cancelled", "denied"],
  "userId": 5,
  "machineId": 1
}
```

| Campo       | Tipo    | Obrigatório | Descrição                                          |
| :---------- | :------ | :---------- | :------------------------------------------------- |
| `before`    | ISO8601 | ✅          | Remove registros anteriores a esta data            |
| `status`    | enum[]  | ❌          | Status a remover (padrão: `finished`, `cancelled`) |
| `userId`    | number  | ❌          | Limitar a um usuário específico                    |
| `machineId` | number  | ❌          | Limitar a uma máquina específica                   |

**Response (200):**

```json
{
  "message": "200 alocações removidas",
  "deletedCount": 200
}
```

---

##### `DELETE /api/v1/system/prune/metrics`

Limpar métricas de alocação antigas.

**Permissão:** Admin

**Request Body:**

```json
{
  "before": "2025-01-01T00:00:00Z"
}
```

**Response (200):**

```json
{
  "message": "50 métricas removidas",
  "deletedCount": 50
}
```

---

### 2. Agente (`/api/v1/agent`)

Autenticação: `Authorization: Bearer <MACHINE_TOKEN>` (middleware `machineAuth`). Ver também `apps/agent/MODULE.md`.

| Método | Rota | Descrição |
|--------|------|-----------|
| PUT | `/sync-specs` | Boot: CPU/GPU, RAM/VRAM (wire), discos, `hostFingerprint`. |
| POST | `/heartbeat` | A cada ~30s: provisionamento SSH, usuários ativos, lote de `sshAttempts`. |
| POST | `/telemetry` | Lotes de métricas (persistidas só com alocação ativa na API). |

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
      "isSudo": false
    }
  ],
  "accessControl": { "shouldBlock": false },
  "currentAllocation": { "id": 3, "userId": 5, "endTime": "2026-07-01T18:00:00.000Z" }
}
```

**Telemetria global (admin):** `GET` / `PUT /api/v1/lab/telemetry-presets` — define fast/eco para todo o parque (persistido em `storage/lab/telemetry_presets.json`). Máquinas com `telemetry_preset: custom` usam só `custom_agent_config`.

**Rotas de interface ainda não detalhadas neste doc** (ver `start/routes.ts`): `machine-groups`, `notifications`, `ssh-attempts`, `GET /allocations/my`, `POST /allocations/:id/extend`, `GET /machines/:id/telemetry/stream`, `POST /machines/:id/request-processes`.

---

## Estrutura interna da API

```
apps/api/
├── app/
│   ├── controllers/      # Lógica de requisições HTTP
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
│   ├── middleware/       # Interceptadores de requisição
│   │   ├── auth_middleware.ts
│   │   ├── machine_auth_middleware.ts
│   │   └── is_admin_middleware.ts
│   ├── models/           # Entidades do banco de dados
│   │   ├── user.ts
│   │   ├── machine.ts
│   │   ├── allocation.ts
│   │   └── telemetry.ts
│   ├── services/         # Serviços auxiliares
│   │   ├── lab_config.ts
│   │   ├── heartbeat_service.ts
│   │   ├── allocation_summarizer.ts
│   │   ├── machine_cache.ts
│   │   └── telemetry_buffer.ts
│   └── validators/       # Esquemas de validação
├── config/               # Configurações do framework
├── database/
│   ├── migrations/       # Versionamento do schema
│   └── seeders/          # Dados de teste
├── start/
│   ├── routes.ts         # Definição de rotas
│   └── kernel.ts         # Middlewares globais
└── tests/                # Testes automatizados
```
