# Comunicação Agente ↔ API

Documentação completa de todas as rotas, payloads, autenticação e comportamentos da comunicação entre os agentes (PC e Servidor) e a API AdonisJS.

---

## Índice

1. [Configuração e Credenciais](#1-configuração-e-credenciais)
2. [Autenticação — MachineAuth Middleware](#2-autenticação--machineauth-middleware)
3. [Rotas Públicas (sem auth)](#3-rotas-públicas-sem-auth)
4. [Rotas do Agente — `/api/agent/*`](#4-rotas-do-agente--apiagent)
   - [POST /heartbeat](#41-post-apiagentheartbeat)
   - [POST /validate-user](#42-post-apiagentvalidate-user)
   - [GET /day-schedule](#43-get-apiagentday-schedule)
   - [POST /quick-allocate](#44-post-apiagentquick-allocate)
   - [POST /report-login](#45-post-apiagentreport-login)
   - [POST /report-logout](#46-post-apiagentreport-logout)
   - [PUT /sync-specs](#47-put-apiagentyync-specs)
   - [POST /telemetry](#48-post-apiagenttelemetry)
   - [GET /ssh/pending](#49-get-apiagenysshpending-apenas-agente-servidor)
   - [POST /ssh/setup](#410-post-apiagenysshsetup-apenas-agente-servidor)
   - [POST /ssh/teardown](#411-post-apiagenyssheartdown-apenas-agente-servidor)
5. [Ciclos de Polling dos Agentes](#5-ciclos-de-polling-dos-agentes)
6. [Fluxo Completo — Agente PC](#6-fluxo-completo--agente-pc)
7. [Fluxo Completo — Agente Servidor](#7-fluxo-completo--agente-servidor)
8. [Infraestrutura de Suporte na API](#8-infraestrutura-de-suporte-na-api)
9. [Códigos de Erro de Autenticação](#9-códigos-de-erro-de-autenticação)

---

## 1. Configuração e Credenciais

Cada agente carrega suas credenciais de um arquivo `.env` (ou variáveis de ambiente do sistema):

| Variável             | Descrição                                                  | Obrigatória |
|----------------------|------------------------------------------------------------|-------------|
| `SERVER_URL`         | URL base da API (ex: `http://192.168.1.10:3333`)           | Sim         |
| `MACHINE_TOKEN`      | Token opaco gerado pela API ao cadastrar a máquina         | Sim         |
| `MAC_ADDRESS`        | MAC da interface de rede principal (auto-detectado se vazio) | Sim*       |
| `HEARTBEAT_INTERVAL` | Intervalo de heartbeat em segundos (padrão: `30`)          | Não         |
| `TELEMETRY_INTERVAL` | Intervalo de telemetria em segundos (padrão: `5`)          | Não         |
| `SSH_POLL_INTERVAL`  | Intervalo de polling SSH em segundos (padrão: `5`, só servidor) | Não    |

\* Se `MAC_ADDRESS` não estiver definido, o agente lê `/sys/class/net/*/address` e usa o primeiro endereço válido encontrado (ignorando loopback e interfaces virtuais).

**Auto-detecção do MAC:**
```
/sys/class/net/eth0/address  →  "AA:BB:CC:DD:EE:FF"
```
Interfaces ignoradas: `lo`, `veth*`, `docker*`, `br-*`, `virbr*`.

---

## 2. Autenticação — MachineAuth Middleware

Todas as rotas sob `/api/agent/*` são protegidas pelo middleware `machineAuth`. A autenticação é **dupla**: token Bearer + MAC Address.

### Cabeçalhos obrigatórios

```http
Authorization: Bearer <MACHINE_TOKEN>
X-Machine-Mac: <MAC_ADDRESS>
Content-Type: application/json
Accept: application/json
```

### Fluxo de validação (MachineAuthMiddleware)

```
Request chega
  │
  ├─ Sem header Authorization → 401 MISSING_HEADER
  ├─ Token vazio → 401 MISSING_TOKEN
  ├─ Sem header X-Machine-Mac → 401 MISSING_MAC
  ├─ Token não encontrado no MachineCache/banco → 401 INVALID_TOKEN
  ├─ MAC não coincide com o registrado → 401 MAC_MISMATCH
  └─ OK → ctx.authenticatedMachine = <Machine> → next()
```

### MachineCache

O middleware usa um **cache em memória** (`MachineCache`) para evitar queries repetidas ao banco a cada request de telemetria:

- TTL: **5 minutos**
- Chave: token da máquina
- Invalidado explicitamente ao alterar `token`, `status`, `loggedUser` ou `macAddress`

---

## 3. Rotas Públicas (sem auth)

Prefixo: `/api`

| Método | Rota         | Descrição                               |
|--------|--------------|-----------------------------------------|
| GET    | `/api/alive` | Health check — retorna `{ alive: true }` |
| GET    | `/api/time`  | Retorna horário UTC atual do servidor    |

O agente PC usa `GET /api/time` para sincronização de relógio na inicialização (`sync_from_server()`).

---

## 4. Rotas do Agente — `/api/agent/*`

Prefixo: `/api/agent`  
Middleware: `machineAuth` (todas as rotas)

---

### 4.1 `POST /api/agent/heartbeat`

**Propósito:** Rota principal de polling. Atualiza o `lastSeenAt` da máquina, retorna estado completo e decisão de bloqueio.

**Query params (opcionais):**

| Parâmetro      | Tipo   | Descrição                                     |
|----------------|--------|-----------------------------------------------|
| `loggedUserId` | number | ID do usuário atualmente logado no SO da máquina |

**Exemplo de request:**
```http
POST /api/agent/heartbeat?loggedUserId=42
Authorization: Bearer eyJhbGci...
X-Machine-Mac: AA:BB:CC:DD:EE:FF
```

**Response `200 OK`:**
```jsonc
{
  "machine": {
    "id": 3,
    "name": "Lab-PC-03",
    "status": "occupied"          // available | occupied | maintenance | offline
  },
  "currentAllocation": {
    "id": 17,
    "userId": 42,
    "userName": "João Silva",
    "userEmail": "joao@email.com",
    "startTime": "2026-04-22T14:00:00.000+00:00",
    "endTime": "2026-04-22T16:00:00.000+00:00",
    "remainingMinutes": 87
  },                              // null se não há alocação ativa
  "nextAllocation": {
    "startTime": "2026-04-22T17:00:00.000+00:00",
    "endTime": "2026-04-22T19:00:00.000+00:00",
    "minutesUntilStart": 153
  },                              // null se não há próxima alocação
  "quickAllocate": {
    "allowed": true,
    "maxDurationMinutes": 115,    // 0 se não permitido
    "minGapMinutes": 20,
    "reason": null                // mensagem explicativa se não permitido
  },
  "shouldBlock": false,           // true se o agente deve exibir tela de bloqueio
  "blockReason": null,            // "MACHINE_MAINTENANCE" | "NO_VALID_ALLOCATION" | null
  "serverTime": "2026-04-22T14:33:00.000Z"
}
```

**Lógica de `shouldBlock`:**

| Condição                                                   | `shouldBlock` | `blockReason`          |
|------------------------------------------------------------|---------------|------------------------|
| `machine.status === 'maintenance'`                         | `true`        | `MACHINE_MAINTENANCE`  |
| `loggedUserId` informado e sem alocação ativa para ele     | `true`        | `NO_VALID_ALLOCATION`  |
| Demais casos                                               | `false`        | `null`                 |

**Efeito colateral:** Se `machine.status === 'offline'`, é atualizado para `'available'`. Se estava `'occupied'` mas não há alocação ativa, é corrigido para `'available'`.

---

### 4.2 `POST /api/agent/validate-user`

**Propósito:** Valida credenciais de um usuário do sistema e verifica se possui alocação ativa para esta máquina. Chamado quando o usuário tenta logar na tela de login do agente PC.

**Body:**
```json
{
  "email": "joao@email.com",
  "password": "senha123"
}
```

**Validações (VineJS):**
- `email`: string, formato e-mail, normalizado
- `password`: string, mínimo 1 caractere

**Response `200 OK` — credenciais inválidas:**
```json
{
  "allowed": false,
  "reason": "INVALID_CREDENTIALS",
  "message": "Email ou senha inválidos."
}
```
*(status HTTP: `401 Unauthorized`)*

**Response `200 OK` — máquina em manutenção:**
```json
{
  "allowed": false,
  "reason": "MACHINE_MAINTENANCE",
  "message": "Esta máquina está em manutenção.",
  "user": { "id": 42, "fullName": "João Silva", "email": "joao@email.com" }
}
```

**Response `200 OK` — sem alocação ativa:**
```json
{
  "allowed": false,
  "reason": "NO_ACTIVE_ALLOCATION",
  "message": "Você não possui uma alocação ativa para esta máquina neste momento.",
  "user": { "id": 42, "fullName": "João Silva", "email": "joao@email.com" },
  "nextAllocation": {
    "id": 18,
    "startTime": "2026-04-22T18:00:00.000+00:00",
    "endTime": "2026-04-22T20:00:00.000+00:00"
  }
}
```

**Response `200 OK` — acesso autorizado:**
```json
{
  "allowed": true,
  "reason": "AUTHORIZED",
  "message": "Acesso autorizado.",
  "user": {
    "id": 42,
    "fullName": "João Silva",
    "email": "joao@email.com",
    "role": "user"
  },
  "allocation": {
    "id": 17,
    "startTime": "2026-04-22T14:00:00.000+00:00",
    "endTime": "2026-04-22T16:00:00.000+00:00",
    "remainingMinutes": 87
  }
}
```

---

### 4.3 `GET /api/agent/day-schedule`

**Propósito:** Retorna a agenda do dia da máquina **sem identificar os usuários** (privacidade na tela de login). Usado para mostrar horários ocupados no agente PC.

**Query params (opcionais):**

| Parâmetro | Tipo   | Descrição                                      |
|-----------|--------|------------------------------------------------|
| `date`    | string | Data no formato `YYYY-MM-DD` (padrão: hoje)    |
| `tz`      | string | Fuso horário IANA (ex: `America/Sao_Paulo`). Define os limites do "dia". Padrão: `UTC` |

**Exemplo:**
```http
GET /api/agent/day-schedule?date=2026-04-22&tz=America/Sao_Paulo
```

**Response `200 OK`:**
```json
{
  "machineId": 3,
  "machineName": "Lab-PC-03",
  "date": "2026-04-22",
  "slots": [
    {
      "startTime": "2026-04-22T14:00:00.000+00:00",
      "endTime": "2026-04-22T16:00:00.000+00:00",
      "isCurrent": true,
      "isPast": false
    },
    {
      "startTime": "2026-04-22T17:00:00.000+00:00",
      "endTime": "2026-04-22T19:00:00.000+00:00",
      "isCurrent": false,
      "isPast": false
    }
  ]
}
```

**Response `400`:** `{ "error": "Formato de data inválido. Use YYYY-MM-DD." }`

---

### 4.4 `POST /api/agent/quick-allocate`

**Propósito:** Cria uma alocação imediata ("on-the-spot") diretamente do agente, sem passar pelo frontend. O usuário informa credenciais e a alocação começa instantaneamente.

**Body:**
```json
{
  "email": "joao@email.com",
  "password": "senha123",
  "durationMinutes": 60
}
```

**Validações (VineJS):**
- `email`: string, formato e-mail, normalizado
- `password`: string, mínimo 1 caractere
- `durationMinutes`: number, positivo, **opcional** (padrão: 120 min)

**Regras de negócio:**
- Deve haver pelo menos **20 minutos** até a próxima alocação (`QUICK_ALLOCATION_MIN_GAP_MINUTES`)
- Gap obrigatório de **5 minutos** entre alocações (`ALLOCATION_GAP_MINUTES`)
- Duração mínima de **10 minutos**
- Duração máxima: `min(120, minutesUntilNext - 5)`
- Aprovação **automática** (status `approved` direto)

**Responses de erro:**

| HTTP | `reason`               | Descrição                                    |
|------|------------------------|----------------------------------------------|
| 401  | `INVALID_CREDENTIALS`  | Email/senha inválidos                        |
| 200  | `MACHINE_MAINTENANCE`  | Máquina em manutenção                        |
| 409  | `MACHINE_OCCUPIED`     | Já existe alocação ativa                     |
| 409  | `INSUFFICIENT_TIME`    | Menos de 20 min até a próxima alocação       |
| 409  | `DURATION_TOO_SHORT`   | Tempo restante é menos de 10 minutos         |
| 409  | `CONFLICT_DETECTED`    | Conflito de horário detectado (safety check) |

**Response `201 Created` — sucesso:**
```json
{
  "success": true,
  "reason": "ALLOCATION_CREATED",
  "message": "Alocação criada com sucesso! Você tem 60 minutos.",
  "allocation": {
    "id": 19,
    "startTime": "2026-04-22T14:33:00.000+00:00",
    "endTime": "2026-04-22T15:33:00.000+00:00",
    "durationMinutes": 60
  },
  "user": {
    "id": 42,
    "fullName": "João Silva",
    "email": "joao@email.com"
  }
}
```

---

### 4.5 `POST /api/agent/report-login`

**Propósito:** Informa ao servidor que um usuário logou no sistema operacional da máquina. Atualiza `machine.loggedUser` e `machine.status = 'occupied'`.

**Body:**
```json
{
  "username": "joao.silva"
}
```

**Validações (VineJS):**
- `username`: string, trimmed, máximo 100 caracteres

**Response `200 OK`:**
```json
{
  "registered": true,
  "message": "Login de 'joao.silva' registrado."
}
```

**Efeito colateral:** Invalida o `MachineCache` para refletir mudança imediatamente.

---

### 4.6 `POST /api/agent/report-logout`

**Propósito:** Informa ao servidor que o usuário deslogou do SO. Atualiza `machine.loggedUser = null` e `machine.status = 'available'`.

**Body:** Nenhum.

**Response `200 OK`:**
```json
{
  "registered": true,
  "message": "Logout de 'joao.silva' registrado."
}
```

**Efeito colateral:** Invalida o `MachineCache`.

---

### 4.7 `PUT /api/agent/sync-specs`

**Propósito:** Sincroniza especificações de hardware detectadas automaticamente pelo agente. Chamado na **inicialização** do agente. O `macAddress` não pode ser atualizado por esta rota (é usado na autenticação).

**Body (todos opcionais):**
```json
{
  "cpuModel": "Intel Core i7-12700",
  "gpuModel": "NVIDIA RTX 3060",
  "totalRamGb": 32,
  "totalDiskGb": 512,
  "ipAddress": "192.168.1.42"
}
```

**Validações (VineJS):**

| Campo        | Tipo   | Restrições                      |
|--------------|--------|---------------------------------|
| `cpuModel`   | string | trimmed, máx. 100 chars         |
| `gpuModel`   | string | trimmed, máx. 100 chars         |
| `totalRamGb` | number | positivo, máx. 1024             |
| `totalDiskGb`| number | positivo, máx. 100000           |
| `ipAddress`  | string | trimmed, máx. 45 chars (IPv6)   |

**Response `200 OK`:**
```json
{
  "synced": true,
  "machine": {
    "id": 3,
    "name": "Lab-PC-03",
    "cpuModel": "Intel Core i7-12700",
    "gpuModel": "NVIDIA RTX 3060",
    "totalRamGb": 32,
    "totalDiskGb": 512,
    "ipAddress": "192.168.1.42"
  }
}
```

**Efeito colateral:** Invalida o `MachineCache`.

---

### 4.8 `POST /api/agent/telemetry`

**Propósito:** Envia métricas de hardware coletadas pelo agente. Sempre retorna `204` (sem body). O servidor separa a lógica de **real-time** (sempre atualiza) de **persistência** (só persiste com alocação ativa).

**Body:**
```json
{
  "cpuUsage": 450,
  "cpuTemp": 620,
  "gpuUsage": 300,
  "gpuTemp": 550,
  "ramUsage": 720,
  "diskUsage": 380,
  "downloadUsage": 12.5,
  "uploadUsage": 3.2,
  "moboTemperature": 410,
  "loggedUserName": "joao.silva"
}
```

**Escala dos valores:** Os campos `*Usage` e `*Temp` são inteiros em escala **0–1000** (representando 0,0% a 100,0% ou 0,0°C a 150,0°C). Valores de rede (`downloadUsage`, `uploadUsage`) são Mbps em ponto flutuante.

**Validações (VineJS):**

| Campo              | Tipo    | Faixa          | Obrigatório |
|--------------------|---------|----------------|-------------|
| `cpuUsage`         | number  | 0–1000         | Sim         |
| `cpuTemp`          | number  | 0–1500         | Sim         |
| `gpuUsage`         | number  | 0–1000         | Sim         |
| `gpuTemp`          | number  | 0–1500         | Sim         |
| `ramUsage`         | number  | 0–1000         | Sim         |
| `diskUsage`        | number  | 0–1000, nullable | Não       |
| `downloadUsage`    | number  | ≥0, nullable   | Não         |
| `uploadUsage`      | number  | ≥0, nullable   | Não         |
| `moboTemperature`  | number  | 0–1500, nullable | Não       |
| `loggedUserName`   | string  | máx. 100 chars | Sim         |

**Response `204 No Content`** (sempre, com ou sem alocação ativa).

**Comportamento do servidor:**
- **Sempre:** Atualiza `latestState` (dashboard real-time) + ring buffer circular (últimas 30 entradas, para playback no frontend)
- **Com alocação ativa:** Adiciona ao `TelemetryBuffer` → batch insert no banco a cada 60s (ou a cada 1000 entradas)
- **Sem alocação ativa:** Só atualiza estado real-time, **não persiste**
- Atualiza `machine.lastSeenAt`; se estava `offline`, muda para `available`

---

### 4.9 `GET /api/agent/ssh/pending` *(apenas Agente Servidor)*

**Propósito:** Retorna lista de sessões SSH pendentes que precisam de geração de chave. O agente servidor faz polling desta rota e, para cada item, gera o par de chaves SSH.

**Response `200 OK`:**
```json
{
  "pending": [
    {
      "sessionId": 5,
      "allocationId": 17,
      "userId": 42,
      "userEmail": "joao@email.com",
      "userName": "João Silva",
      "systemUsername": "render01",
      "endTime": "2026-04-22T16:00:00.000+00:00"
    }
  ]
}
```

**Critério de inclusão:** `SshSession` com `machineId` correspondente, `status = 'active'` e `publicKeyFingerprint IS NULL` (chave ainda não gerada).

---

### 4.10 `POST /api/agent/ssh/setup` *(apenas Agente Servidor)*

**Propósito:** O agente reporta que gerou o par de chaves SSH e envia a **chave privada** para a API entregar ao frontend (via download temporário).

**Body:**
```json
{
  "allocationId": 17,
  "systemUsername": "render01",
  "publicKeyFingerprint": "SHA256:abc123...",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

**Validações (VineJS):**

| Campo                   | Tipo   | Restrições                   |
|-------------------------|--------|------------------------------|
| `allocationId`          | number | positivo                     |
| `systemUsername`        | string | trimmed, máx. 64 chars       |
| `publicKeyFingerprint`  | string | trimmed, máx. 128 chars      |
| `privateKey`            | string | trimmed, mínimo 1 caractere  |

**Response `200 OK`:**
```json
{
  "success": true,
  "sessionId": 5,
  "message": "Sessão SSH configurada com sucesso. Chave pronta para entrega."
}
```

**Efeito colateral:** A chave privada é armazenada no `SshKeyStore` (Map em memória) com expiração de **5 minutos**. O `publicKeyFingerprint` é persistido na tabela `ssh_sessions`.

---

### 4.11 `POST /api/agent/ssh/teardown` *(apenas Agente Servidor)*

**Propósito:** O agente informa que revogou as chaves SSH de uma alocação (cleanup ao término da alocação).

**Body:**
```json
{
  "allocationId": 17
}
```

**Validações (VineJS):**
- `allocationId`: number, positivo

**Response `200 OK`:**
```json
{
  "success": true,
  "revokedCount": 1,
  "message": "Sessões SSH revogadas com sucesso."
}
```

**Efeito colateral:** Define `SshSession.status = 'revoked'` e `revokedAt = now()` para todas as sessões ativas da alocação. Remove a chave privada do `SshKeyStore`.

---

## 5. Ciclos de Polling dos Agentes

### Agente PC

| Thread       | Função              | Intervalo padrão | Observações                                      |
|--------------|---------------------|------------------|--------------------------------------------------|
| `heartbeat`  | `POST /heartbeat`   | 30s              | Primeiro heartbeat é imediato ao iniciar         |
| `telemetry`  | `POST /telemetry`   | 5s               | Só envia se há alocação ativa ou sempre? **Envia sempre** |

### Agente Servidor

| Thread       | Função                        | Intervalo padrão | Observações                        |
|--------------|-------------------------------|------------------|------------------------------------|
| `heartbeat`  | `POST /heartbeat`             | 30s              | Primeiro imediato                  |
| `telemetry`  | `POST /telemetry`             | 5s               | Envia sempre                       |
| `ssh-poll`   | `GET /ssh/pending`            | 5s               | Verifica sessões a configurar      |

**Inicialização (ambos):** `PUT /sync-specs` é chamado uma única vez antes de iniciar os loops.

---

## 6. Fluxo Completo — Agente PC

```
Inicialização
  ├── Valida .env (MACHINE_TOKEN, MAC_ADDRESS obrigatórios)
  ├── sync_ntp() — sincroniza relógio via NTP
  ├── GET /api/time — sincroniza horário com servidor (fallback)
  └── PUT /api/agent/sync-specs — envia specs detectadas pelo hardware

Loop de Heartbeat (a cada 30s)
  └── POST /api/agent/heartbeat?loggedUserId=<id|nenhum>
        ├── shouldBlock = false → hide overlay (desbloqueia tela)
        ├── shouldBlock = true  → show overlay (bloqueia tela)
        └── quickAllocate.allowed → exibe/oculta botão de alocação rápida

Loop de Telemetria (a cada 5s)
  └── POST /api/agent/telemetry { cpuUsage, cpuTemp, ... }

Evento: usuário tenta logar no overlay
  └── POST /api/agent/validate-user { email, password }
        ├── allowed = true  → permite login, chama PAM/xdg-open
        │                     POST /api/agent/report-login { username }
        └── allowed = false → exibe mensagem de erro no overlay

Evento: usuário deslogar do SO
  └── POST /api/agent/report-logout

Evento: usuário clica em "Alocação Rápida" no overlay
  └── POST /api/agent/quick-allocate { email, password, durationMinutes? }
        ├── success = true  → realiza login normalmente
        └── success = false → exibe razão do erro

Encerramento
  └── POST /api/agent/report-logout (se havia usuário logado)
```

---

## 7. Fluxo Completo — Agente Servidor

```
Inicialização (requer root)
  ├── Valida .env
  └── PUT /api/agent/sync-specs

Loop de Heartbeat (a cada 30s)
  └── POST /api/agent/heartbeat
        └── currentAllocation → aplica cgroups v2 para o usuário dono

Loop de Telemetria (a cada 5s)
  └── POST /api/agent/telemetry { cpuUsage, ..., loggedUserName }

Loop de SSH Polling (a cada 5s)
  └── GET /api/agent/ssh/pending
        ├── pending = [] → nada a fazer
        └── pending = [{ sessionId, allocationId, systemUsername, ... }]
              ├── gera par de chaves RSA/ED25519
              ├── adiciona chave pública em ~/.ssh/authorized_keys do systemUsername
              └── POST /api/agent/ssh/setup {
                    allocationId, systemUsername,
                    publicKeyFingerprint, privateKey
                  }

Evento: alocação expira ou agente encerra
  └── ssh.revoke_all()
        ├── remove chaves de authorized_keys
        └── POST /api/agent/ssh/teardown { allocationId } (para cada sessão)

Encerramento
  ├── revoga todas as sessões SSH
  ├── cgroup.reset_all() — restaura pesos de CPU padrão
  └── POST /api/agent/report-logout
```

---

## 8. Infraestrutura de Suporte na API

### TelemetryBuffer

- **Propósito:** Otimizar writes de telemetria no banco.
- **`latestState`:** Map `machineId → TelemetryData` — estado mais recente de cada máquina para o dashboard real-time.
- **Ring buffer:** Últimas **30 entradas** por máquina — usadas para playback no frontend.
- **Batch insert:** Flush automático a cada **60 segundos** ou quando o buffer atinge **1000 entradas**.
- **Escrita condicional:** Só persiste no banco se `allocationId` é válido (≠ 0).

### MachineCache

- **Propósito:** Evitar query ao banco a cada request de telemetria (que chega a cada 5s).
- **TTL:** 5 minutos.
- **Invalidação:** Chamada explícita `machineCache.invalidate(token)` após `report-login`, `report-logout`, `sync-specs`.

### SshKeyStore

- **Propósito:** Armazenamento temporário em memória da chave privada SSH para entrega ao frontend.
- **TTL:** **5 minutos** após o `ssh/setup`.
- **Auto-cleanup:** `setTimeout` remove a entrada ao expirar.
- **Removida também** no `ssh/teardown`.

---

## 9. Códigos de Erro de Autenticação

Todos os erros de autenticação retornam `401 Unauthorized` com o seguinte formato:

```json
{
  "code": "<CODE>",
  "message": "<descrição legível>"
}
```

| `code`            | Causa                                                   |
|-------------------|---------------------------------------------------------|
| `MISSING_HEADER`  | Header `Authorization` ausente                          |
| `MISSING_TOKEN`   | Token vazio após extrair do header                      |
| `MISSING_MAC`     | Header `X-Machine-Mac` ausente                          |
| `INVALID_TOKEN`   | Token não encontrado no banco (máquina não cadastrada)  |
| `MAC_MISMATCH`    | MAC Address não coincide com o registrado para o token  |
