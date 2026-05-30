# Módulo Agente

## Papel

O agente roda localmente nas máquinas do laboratório e é responsável por:

- aplicar decisões de acesso (bloquear/liberar sessão);
- coletar telemetria de hardware e processos;
- provisionar usuários do SO e sincronizar `authorized_keys` (apenas no agente de servidor).

## Variantes

- **Agente PC**: inclui interface local (overlay/login) e fluxo de validação de credenciais.
- **Agente Servidor**: opera headless, provisiona usuários do SO e controla recursos via cgroups.

## Ciclos de comunicação

- **Heartbeat** (`POST /api/agent/heartbeat`): envia estado local e recebe decisão (`shouldBlock`, alocação atual/próxima, revogações pendentes).
- **Telemetria** (`POST /api/agent/telemetry`): envia métricas periódicas (CPU/GPU/RAM, rede, processos em JSON).
- **Provisionamento de usuários (servidor)**:
  - Recebe instruções no heartbeat (ou endpoint dedicado) e aplica usuário + chave pública.
  - Reporta sucesso no ciclo seguinte.

## Autenticação

- O agente autentica via token da máquina (`Authorization: Bearer <token>`).

## Saídas locais

- Criação/atualização de usuários do sistema e `authorized_keys` com a chave pública do usuário.
- Aplicação de políticas de acesso (bloqueio de sessão gráfica ou restrição via cgroups).
- Coleta de telemetria enriquecida, com fallback quando GPU não está disponível.

---

## Fluxo de Comunicação (migrado do README geral)

### Fluxo do Agente (Heartbeat)

```
┌─────────┐                    ┌─────────┐                    ┌──────────┐
│ AGENTE  │                    │   API   │                    │ DATABASE │
└────┬────┘                    └────┬────┘                    └────┬─────┘
     │                              │                              │
     │  POST /api/agent/heartbeat   │                              │
     │  {telemetry: {...}}          │                              │
     │─────────────────────────────>│                              │
     │                              │   Verificar Agent Key        │
     │                              │   (MachineCache)             │
     │                              │                              │
     │                              │   Buscar alocação ativa      │
     │                              │─────────────────────────────>│
     │                              │<─────────────────────────────│
     │                              │                              │
     │                              │   Buffer telemetria          │
     │                              │                              │
     │  {                           │                              │
     │    machineId,                │                              │
     │    shouldBlock,              │                              │
     │    canQuickAllocate,         │                              │
     │    currentAllocation {...}   │                              │
     │  }                           │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
```

### Fluxo de Login na Máquina

```
┌─────────┐                    ┌─────────┐                    ┌──────────┐
│ AGENTE  │                    │   API   │                    │ DATABASE │
└────┬────┘                    └────┬────┘                    └────┬─────┘
     │                              │                              │
     │  POST /api/agent/validate    │                              │
     │  {email, password}           │                              │
     │─────────────────────────────>│                              │
     │                              │   Validar credenciais        │
     │                              │   (hash comparison)          │
     │                              │─────────────────────────────>│
     │                              │<─────────────────────────────│
     │                              │                              │
     │  {valid: true/false,         │                              │
     │   hasAllocation: bool,       │                              │
     │   canQuickAllocate: bool}    │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
     │  [Se válido e tem alocação]  │                              │
     │  POST /api/agent/report-login│                              │
     │─────────────────────────────>│   Registrar actual_login     │
     │                              │─────────────────────────────>│
     │                              │                              │
```

---

## Ciclo de Vida do Agente (Polling)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CICLO DE VIDA DO AGENTE                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │                    BOOT DO AGENTE                                │          │
│   │  1. Lê token do arquivo de config local                          │          │
│   │  2. PUT /sync-specs → Envia specs detectadas (CPU, RAM, etc)     │          │
│   │  3. POST /heartbeat → Registra que está online                   │          │
│   └──────────────────────────────────────────────────────────────────┘          │
│                              │                                                  │
│                              ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │              LOOP PRINCIPAL (enquanto máquina ligada)            │          │
│   │                                                                  │
│   │   A cada 30s:  POST /heartbeat                                   │
│   │                └─ Mantém status online                           │
│   │                └─ Recebe se deve bloquear                        │
│   │                └─ Recebe alocação atual (se houver)              │
│   │                                                                  │
│   │   A cada 10s:  POST /telemetry                                   │
│   │                └─ Envia métricas CPU/RAM/GPU/Temp                 │
│   │                                                                  │
│   └──────────────────────────────────────────────────────────────────┘          │
│                              │                                                  │
│                              ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │              QUANDO USUÁRIO TENTA LOGAR NO SO                    │          │
│   │                                                                  │
│   │   1. POST /validate-user {email, password}                       │
│   │      └─ allowed: true  → Permite login                           │
│   │      └─ allowed: false → Bloqueia e mostra mensagem              │
│   │                                                                  │
│   │   2. Se permitiu → POST /report-login {username}                 │
│   │      └─ Registra quem logou para auditoria                       │
│   │                                                                  │
│   └──────────────────────────────────────────────────────────────────┘          │
│                              │                                                  │
│                              ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │              DURANTE A SESSÃO DO USUÁRIO                         │
│   │                                                                  │
│   │   A cada 60s:  GET /should-block?loggedUserId=123                │
│   │                └─ shouldBlock: true  → Força logout              │
│   │                └─ shouldBlock: false → Continua                  │
│   │                └─ remainingMinutes: 15 → Avisa usuário           │
│   │                                                                  │
│   └──────────────────────────────────────────────────────────────────┘          │
│                              │                                                  │
│                              ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │              QUANDO USUÁRIO FAZ LOGOUT                           │
│   │                                                                  │
│   │   POST /report-logout                                            │
│   │   └─ Libera a máquina para o próximo                             │
│   │                                                                  │
│   └──────────────────────────────────────────────────────────────────┘          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Intervalos Recomendados de Polling

| Rota               | Intervalo   | Descrição                          |
| :----------------- | :---------- | :--------------------------------- |
| `/heartbeat`       | 30s         | Manter online + status de bloqueio |
| `/telemetry`       | 10s         | Métricas de hardware               |
| `/should-block`    | 60s         | Verificar se alocação foi revogada |
| `/validate-user`   | Sob demanda | Quando usuário tenta logar         |
| `/report-login`    | Sob demanda | Após login bem-sucedido            |
| `/report-logout`   | Sob demanda | Quando usuário sai                 |
| `/allocations`     | Sob demanda | Consultar agenda da máquina        |
| `/current-session` | Sob demanda | Quem deveria estar usando          |
| `/sync-specs`      | No boot     | Atualizar specs detectadas         |

---

## Endpoints do Agente (`/api/agent`)

##### `POST /api/agent/heartbeat`

Heartbeat - Mantém a máquina online e retorna status de controle.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Response (200):**

```json
{
  "machine": {
    "id": 1,
    "name": "PC-LAB-01",
    "status": "available"
  },
  "currentAllocation": {
    "id": 5,
    "userId": 3,
    "userEmail": "aluno@ufpel.edu.br",
    "userName": "Gabriel Santos",
    "startTime": "2026-01-28T08:00:00.000Z",
    "endTime": "2026-01-28T12:00:00.000Z"
  },
  "shouldBlock": false,
  "serverTime": "2026-01-28T10:30:00.000Z"
}
```

| Campo               | Tipo    | Descrição                                 |
| :------------------ | :------ | :---------------------------------------- |
| `machine`           | object  | Dados da máquina                          |
| `currentAllocation` | object? | Alocação ativa no momento (null se livre) |
| `shouldBlock`       | boolean | Se true, bloquear a máquina imediatamente |
| `serverTime`        | string  | Hora do servidor (para sincronização)     |

---

##### `POST /api/agent/validate-user`

Valida credenciais de um usuário e verifica se tem alocação ativa.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Request Body:**

```json
{
  "email": "aluno@ufpel.edu.br",
  "password": "senha123"
}
```

**Response - Autorizado (200):**

```json
{
  "allowed": true,
  "reason": "AUTHORIZED",
  "message": "Acesso autorizado.",
  "user": {
    "id": 3,
    "fullName": "Gabriel Santos",
    "email": "aluno@ufpel.edu.br",
    "role": "user"
  },
  "allocation": {
    "id": 5,
    "startTime": "2026-01-28T08:00:00.000Z",
    "endTime": "2026-01-28T12:00:00.000Z",
    "remainingMinutes": 90
  }
}
```

**Response - Sem Alocação (200):**

```json
{
  "allowed": false,
  "reason": "NO_ACTIVE_ALLOCATION",
  "message": "Você não possui uma alocação ativa para esta máquina neste momento.",
  "user": {
    "id": 3,
    "fullName": "Gabriel Santos",
    "email": "aluno@ufpel.edu.br"
  },
  "nextAllocation": {
    "id": 6,
    "startTime": "2026-01-28T14:00:00.000Z",
    "endTime": "2026-01-28T18:00:00.000Z"
  }
}
```

**Response - Credenciais Inválidas (401):**

```json
{
  "allowed": false,
  "reason": "INVALID_CREDENTIALS",
  "message": "Email ou senha inválidos."
}
```

**Códigos de Razão:**
| Código | Descrição |
| :---------------------- | :--------------------------------------- |
| `AUTHORIZED` | Usuário tem alocação ativa - permitir |
| `NO_ACTIVE_ALLOCATION` | Sem alocação para este horário |
| `INVALID_CREDENTIALS` | Email/senha incorretos |
| `MACHINE_MAINTENANCE` | Máquina em manutenção |

---

##### `GET /api/agent/should-block`

Verifica se o agente deve bloquear a máquina (polling durante sessão).

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Query Params:**
| Param | Tipo | Obrigatório | Descrição |
| :------------- | :----- | :---------- | :--------------------------- |
| `loggedUserId` | number | ❌ | ID do usuário logado no SO |

**Response - Não Bloquear (200):**

```json
{
  "shouldBlock": false,
  "reason": "VALID_ALLOCATION",
  "allocation": {
    "id": 5,
    "endTime": "2026-01-28T12:00:00.000Z",
    "remainingMinutes": 45
  }
}
```

**Response - Bloquear (200):**

```json
{
  "shouldBlock": true,
  "reason": "ALLOCATION_EXPIRED_OR_REVOKED",
  "message": "Alocação expirou ou foi revogada."
}
```

**Códigos de Razão:**
| Código | Descrição |
| :--------------------------- | :--------------------------------------- |
| `VALID_ALLOCATION` | Alocação válida - não bloquear |
| `ALLOCATION_EXPIRED_OR_REVOKED` | Alocação expirou/cancelada - bloquear |
| `MACHINE_MAINTENANCE` | Admin colocou em manutenção - bloquear |

---

##### `GET /api/agent/allocations`

Lista alocações ativas e futuras da máquina.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Response (200):**

```json
{
  "machineId": 1,
  "machineName": "PC-LAB-01",
  "allocations": [
    {
      "id": 5,
      "userId": 3,
      "userEmail": "aluno@ufpel.edu.br",
      "userName": "Gabriel Santos",
      "startTime": "2026-01-28T08:00:00.000Z",
      "endTime": "2026-01-28T12:00:00.000Z",
      "status": "approved",
      "isCurrent": true
    },
    {
      "id": 6,
      "userId": 4,
      "userEmail": "outro@ufpel.edu.br",
      "userName": "Maria Silva",
      "startTime": "2026-01-28T14:00:00.000Z",
      "endTime": "2026-01-28T18:00:00.000Z",
      "status": "approved",
      "isCurrent": false
    }
  ]
}
```

---

##### `GET /api/agent/current-session`

Retorna quem deveria estar usando a máquina agora.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Response - Com Sessão (200):**

```json
{
  "hasActiveSession": true,
  "session": {
    "allocationId": 5,
    "user": {
      "id": 3,
      "email": "aluno@ufpel.edu.br",
      "fullName": "Gabriel Santos"
    },
    "startTime": "2026-01-28T08:00:00.000Z",
    "endTime": "2026-01-28T12:00:00.000Z",
    "remainingMinutes": 45
  },
  "machineStatus": "occupied"
}
```

**Response - Sem Sessão (200):**

```json
{
  "hasActiveSession": false,
  "session": null,
  "machineStatus": "available"
}
```

---

##### `POST /api/agent/report-login`

Reporta que um usuário logou no SO da máquina.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Request Body:**

```json
{
  "username": "gabriel.santos"
}
```

**Response (200):**

```json
{
  "registered": true,
  "message": "Login de 'gabriel.santos' registrado."
}
```

---

##### `POST /api/agent/report-logout`

Reporta que o usuário deslogou do SO da máquina.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Response (200):**

```json
{
  "registered": true,
  "message": "Logout de 'gabriel.santos' registrado."
}
```

---

##### `PUT /api/agent/sync-specs`

Sincroniza especificações de hardware detectadas automaticamente.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Request Body:**

```json
{
  "cpuModel": "Intel Core i7-12700K",
  "gpuModel": "NVIDIA GeForce RTX 3060",
  "totalRamGb": 16,
  "totalDiskGb": 512,
  "ipAddress": "192.168.1.100",
  "macAddress": "AA:BB:CC:DD:EE:FF"
}
```

| Campo         | Tipo   | Obrigatório | Descrição                                  |
| :------------ | :----- | :---------- | :----------------------------------------- |
| `cpuModel`    | string | ❌          | Modelo do processador                      |
| `gpuModel`    | string | ❌          | Modelo da GPU                              |
| `totalRamGb`  | number | ❌          | RAM total em GB                            |
| `totalDiskGb` | number | ❌          | Disco total em GB                          |
| `ipAddress`   | string | ❌          | Endereço IP atual                          |
| `macAddress`  | string | ❌          | MAC Address (formato: `AA:BB:CC:DD:EE:FF`) |

**Response (200):**

```json
{
  "synced": true,
  "machine": {
    "id": 1,
    "name": "PC-LAB-01",
    "cpuModel": "Intel Core i7-12700K",
    "gpuModel": "NVIDIA GeForce RTX 3060",
    "totalRamGb": 16,
    "totalDiskGb": 512,
    "ipAddress": "192.168.1.100",
    "macAddress": "AA:BB:CC:DD:EE:FF"
  }
}
```

---

##### `POST /api/agent/telemetry`

Envia pacote de métricas de hardware.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Request Body:**

```json
{
  "cpuUsage": 250,
  "cpuTemp": 650,
  "gpuUsage": 100,
  "gpuTemp": 550,
  "ramUsage": 450,
  "diskUsage": 300,
  "downloadUsage": 50.5,
  "uploadUsage": 10.2,
  "moboTemperature": 450,
  "loggedUserName": "gabriel.santos"
}
```

| Campo             | Tipo   | Obrigatório | Descrição                                |
| :---------------- | :----- | :---------- | :--------------------------------------- |
| `cpuUsage`        | number | ✅          | Uso da CPU (0-1000 = 0.0%-100.0%)        |
| `cpuTemp`         | number | ✅          | Temperatura CPU (0-1500 = 0.0°C-150.0°C) |
| `gpuUsage`        | number | ✅          | Uso da GPU (0-1000)                      |
| `gpuTemp`         | number | ✅          | Temperatura GPU (0-1500)                 |
| `ramUsage`        | number | ✅          | Uso da RAM (0-1000)                      |
| `diskUsage`       | number | ✅          | Uso do disco (0-1000)                    |
| `downloadUsage`   | number | ✅          | Download em Mbps                         |
| `uploadUsage`     | number | ✅          | Upload em Mbps                           |
| `moboTemperature` | number | ❌          | Temperatura da placa-mãe (0-1500)        |
| `loggedUserName`  | string | ❌          | Nome do usuário logado no SO             |

**Response (204):** No Content

---

## Configuração do Agente

### Arquivo de Configuração

O agente deve ler o token de um arquivo de configuração local:

**Linux:** `/etc/lab-agent/config.yaml`
**Windows:** `C:\ProgramData\LabAgent\config.yaml`

```yaml
# Configuração do Lab Agent
api_url: "https://api.lab.ufpel.edu.br"
machine_token: "38429811d7f5e8841b961733e2f21821..."

# Intervalos de polling (em segundos)
polling:
  heartbeat_interval: 30
  telemetry_interval: 10
  block_check_interval: 60

# Comportamento
behavior:
  block_on_no_allocation: true # Bloquear se não houver alocação?
  warn_before_expire_minutes: 15 # Avisar X minutos antes de expirar
  force_logout_on_expire: true # Forçar logout quando alocação expirar?
```

### Processo de Setup

1. **Admin cria máquina** via `POST /api/v1/machines` ou interface web
2. **Admin copia o token** retornado na criação (ou via `GET /api/v1/machines/:id`)
3. **Admin instala o agente** na máquina física
4. **Admin configura o token** no arquivo de config do agente
5. **Agente inicia** e faz `PUT /sync-specs` + `POST /heartbeat`
6. **Máquina fica online** e pronta para uso

### Rotação de Token (Segurança)

Se o token for comprometido:

```http
POST /api/v1/machines/1/regenerate-token
Authorization: Bearer <ADMIN_USER_TOKEN>
```

Resposta:

```json
{
  "message": "Token regenerado com sucesso. Configure o agente com o novo token.",
  "machineId": 1,
  "token": "novo_token_aqui...",
  "tokenRotatedAt": "2026-01-28T12:00:00.000Z"
}
```

O admin deve então atualizar o config do agente na máquina física.

---

## Agente de Máquina (detalhado)

### Responsabilidades

O agente de máquina é um software instalado em cada computador do laboratório, responsável por:

- **Comunicação**: Manter conexão com a API central via heartbeats periódicos
- **Autenticação Local**: Interceptar tentativas de login e validar permissões
- **Bloqueio de Tela**: Bloquear acesso quando não há alocação ativa
- **Coleta de Métricas**: Monitorar uso de CPU, memória e disco
- **Sincronização**: Reportar especificações de hardware

### Diagrama de Estados

```
                              ┌─────────────────┐
                              │                 │
                              │   INICIALIZADO  │
                              │                 │
                              └────────┬────────┘
                                       │
                                       │ Conectar à API
                                       ▼
                              ┌─────────────────┐
                              │                 │
              ┌───────────────│    OCIOSO       │───────────────┐
              │               │  (Tela Bloqueada)               │
              │               └────────┬────────┘               │
              │                        │                        │
              │ Heartbeat              │ Usuário tenta          │ Heartbeat
              │ (a cada 30s)           │ fazer login            │ (shouldBlock=false)
              │                        ▼                        │
              │               ┌─────────────────┐               │
              │               │                 │               │
              │               │   VALIDANDO     │               │
              │               │   CREDENCIAIS   │               │
              │               │                 │               │
              │               └────────┬────────┘               │
              │                        │                        │
              │            ┌───────────┴───────────┐            │
              │            │                       │            │
              │     Válido + Alocação        Inválido ou        │
              │            │                 Sem Alocação       │
              │            ▼                       │            │
              │   ┌─────────────────┐              │            │
              │   │                 │              │            │
              └──>│     ATIVO       │<─────────────┘            │
                  │ (Sessão do User)│                           │
                  │                 │                           │
                  └────────┬────────┘                           │
                           │                                    │
                           │ Logout ou                          │
                           │ Fim da alocação                    │
                           │                                    │
                           └────────────────────────────────────┘
```

### Ciclo de Heartbeat

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CICLO DE HEARTBEAT                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Intervalo: 30 segundos                                                 │
│                                                                          │
│  Dados enviados:                                                        │
│  {                                                                       │
│    "telemetry": {                                                       │
│      "cpuPercent": 45.2,                                                │
│      "ramPercent": 68.5,                                                │
│      "diskPercent": 52.0                                                │
│    }                                                                     │
│  }                                                                       │
│                                                                          │
│  Dados recebidos:                                                       │
│  {                                                                       │
│    "machineId": 1,                                                      │
│    "shouldBlock": false,          // Bloquear tela?                     │
│    "canQuickAllocate": true,      // Permitir alocação rápida?          │
│    "minutesUntilNext": 45,        // Minutos até próxima alocação       │
│    "currentAllocation": {         // Alocação ativa (se houver)         │
│      "id": 123,                                                         │
│      "userId": 5,                                                       │
│      "startsAt": "2026-02-02T10:00:00",                                │
│      "endsAt": "2026-02-02T11:00:00"                                   │
│    }                                                                     │
│  }                                                                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```
