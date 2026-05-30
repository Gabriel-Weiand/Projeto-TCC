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

- **Frontend Web**: rotas REST sob `/api/v1` para login, CRUD de usuários, máquinas e alocações, além de leitura de métricas e notificações.
- **Agentes**: rotas sob `/api/agent` para heartbeat, validação de login local e telemetria.

## Saídas de comunicação

- **Para agentes**: respostas de heartbeat com `shouldBlock`, `currentAllocation`, `nextAllocation` e instruções de provisionamento (usuário do SO + chave pública).
- **Para frontend**: dados de alocação, máquinas e métricas consolidadas, além de notificações de sistema.

## Persistência (migrations atuais)

- `users` com `system_username` e `ssh_public_key`.
- `machines` com token do agente, specs e status.
- `allocations` com janela de uso e `is_sudo`.
- `telemetries` com amostras brutas e processos em JSON.
- `allocation_metrics` com médias e picos por sessão.
- `machine_accounts` para rastrear usuários do SO provisionados por máquina.
- `notifications` como caixa de entrada por usuário.

## Consolidação de telemetria

- **Média ponderada pelo tempo (TWA):**

$TWA = \frac{\sum (v_i \cdot \Delta t_i)}{T_{total}}$

- **Fallback de GPU:** dados nulos/zerados de GPU são ignorados na consolidação, sem interromper o cálculo das demais métricas.

## Observações

- `system_username` deve ser estável/imutável por regra de negócio (a constraint explícita não está no schema).
- Caso a autenticação do agente use MAC address, o schema precisa armazenar este campo na tabela `machines`.

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
│  1. Login: POST /api/auth/login                             │
│     Body: { email, password }                               │
│     → Senha verificada contra hash no banco                 │
│     Response: { token, user }                               │
│                                                             │
│  2. Requisições autenticadas:                               │
│     Header: Authorization: Bearer <token>                   │
│     → Token validado (hash SHA-256 comparado)               │
│                                                             │
│  3. Logout: DELETE /api/auth/logout                         │
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
│  • Headers: Authorization: Bearer <token>                   │
│             X-Machine-Mac: <mac_address>                     │
│  • Cache de 5 minutos para reduzir consultas ao banco       │
│  • Usado apenas nas rotas /api/agent/*                      │
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

### Regra de Quick Allocate

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      REGRA DE QUICK ALLOCATE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Condições para permitir alocação rápida:                               │
│  1. Máquina não deve ter alocação ativa no momento                      │
│  2. Próxima alocação agendada deve estar a pelo menos 20 minutos        │
│  3. Duração máxima: 60 minutos                                          │
│  4. Duração padrão: mínimo entre 60 min e tempo até próxima alocação    │
│                                                                         │
│  Cenário permitido:                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ AGORA          +20min              +60min                        │   │
│  │   │              │                    │                          │   │
│  │   ├──────────────┼────────────────────┤                          │   │
│  │   │   LIVRE      │    Quick Allocate  │  Próxima alocação        │   │
│  │   │   (OK!)      │    (até 1h)        │  agendada                │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

A API é segmentada por prefixos e versões para isolar a lógica de interação humana da lógica de automação das máquinas.

**Base URL:** `/api/v1` (Para rotas de interface)

---

### 1. Interface & Gestão (`/api/v1`)

_Destinadas ao Frontend Web/Mobile. Requer Header `Authorization: Bearer <USER_TOKEN>` (exceto login)._

---

#### 🔐 Auth & Perfil

##### `POST /api/v1/login`

Autenticação e geração de token JWT.

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
  "macAddress": "AA:BB:CC:DD:EE:FF",
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
| `totalDiskGb` | number | ❌          | Disco total em GB                                 |
| `ipAddress`   | string | ❌          | Endereço IP                                       |
| `macAddress`  | string | ❌          | MAC Address (formato: `AA:BB:CC:DD:EE:FF`)        |
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

> ⚠️ **Visibilidade:** `macAddress` só é retornado para administradores. Usuários normais não recebem este campo.

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
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "latestTelemetry": {
      "cpuUsage": 250,
      "ramUsage": 450,
      "createdAt": "2026-01-28T12:00:00.000Z"
    }
  }
]
```

> 🔒 **Admin:** Resposta inclui `macAddress`. **Usuário normal:** `macAddress` é omitido.

---

##### `GET /api/v1/machines/:id`

Detalhes técnicos de uma máquina específica.

**Permissão:** Geral (autenticado)

**Response para Admin (200):** Inclui `token` e `macAddress`

```json
{
  "id": 1,
  "name": "PC-LAB-01",
  "description": "Computador do laboratório 1",
  "cpuModel": "Intel Core i7-12700K",
  "gpuModel": "NVIDIA GeForce RTX 3060",
  "totalRamGb": 16,
  "totalDiskGb": 512,
  "ipAddress": "192.168.1.100",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "status": "available",
  "lastSeenAt": "2026-01-28T12:00:00.000Z",
  "loggedUser": "gabriel.santos",
  "token": "38429811d7f5e8841b961733e2f21821...",
  "tokenRotatedAt": null,
  "createdAt": "2026-01-28T12:00:00.000Z",
  "updatedAt": "2026-01-28T12:00:00.000Z",
  "latestTelemetry": {
    "cpuUsage": 250,
    "ramUsage": 450,
    "createdAt": "2026-01-28T12:00:00.000Z"
  }
}
```

**Response para Usuário Normal (200):** Sem `token` e sem `macAddress`

> 🔒 **Admin:** Resposta inclui `token` e `macAddress`. **Usuário normal:** ambos são omitidos.

> ⚠️ **Importante:** O `token` é sensível. Use apenas para configurar o agente.

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
      "cpuUsage": 250,
      "cpuTemp": 650,
      "gpuUsage": 100,
      "gpuTemp": 550,
      "ramUsage": 450,
      "diskUsage": 300,
      "downloadUsage": 50,
      "uploadUsage": 10,
      "createdAt": "2026-01-28T12:00:00.000Z"
    }
  ]
}
```

> 📊 **Nota:** Valores de uso são em escala 0-1000 (representa 0.0% a 100.0%). Temperaturas em décimos de grau (650 = 65.0°C).

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

**Response para Usuário Normal (200) - Anonimizado:**

```json
{
  "meta": { "total": 10, "perPage": 20, "currentPage": 1, "lastPage": 1 },
  "data": [
    {
      "id": 1,
      "machineId": 1,
      "startTime": "2026-01-28T08:00:00.000Z",
      "endTime": "2026-01-28T12:00:00.000Z",
      "status": "approved"
    }
  ]
}
```

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

#### 🧹 Manutenção (Admin Only)

##### `DELETE /api/v1/maintenance/telemetries/:telemetryId`

Apagar um registro específico de telemetria.

**Permissão:** Admin

**Response (200):**

```json
{
  "message": "Telemetria removida com sucesso"
}
```

---

##### `DELETE /api/v1/maintenance/metrics/:metricId`

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

## Estrutura interna da API

```
apps/api/
├── app/
│   ├── controllers/      # Lógica de requisições HTTP
│   │   ├── agent_controller.ts
│   │   ├── allocations_controller.ts
│   │   ├── auth_controller.ts
│   │   ├── machines_controller.ts
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
