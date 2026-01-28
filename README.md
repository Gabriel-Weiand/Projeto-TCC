# Sistema Distribuído de Gestão de Laboratórios

Este projeto é parte fundamental do Trabalho de Conclusão de Curso (TCC) na Universidade Federal de Pelotas (Ufpel). Ele tem como objetivo abranger uma solução completa para o gerenciamento de alocação, monitoramento e controle de acesso em máquinas de laboratórios universitários de pesquisa. O sistema tem como objetivo operar em uma arquitetura distribuída composta por uma API central, um dashboard e site para alocações web e agentes locais instalados nas máquinas.

## 🎯 Contexto e Solução

Atualmente, a gestão de recursos computacionais em alguns laboratórios de pesquisa depende de planilhas e comunicação informal, o que compromete a eficiência e a segurança dos ativos.

A solução foi projetada sob a ótica de **Sistemas Distribuídos**, visando garantir a convergência entre:

1.  **Estado Desejado:** O agendamento definido no sistema web.
2.  **Estado Real:** O comportamento efetivo da máquina física no laboratório.

## 🏛 Arquitetura do Sistema

O projeto adota uma estrutura de **Monorepo** organizada, onde a API Central orquestra as regras de negócio para dois clientes distintos. A arquitetura foca na separação de responsabilidades de autenticação:

1.  **Backend (API Central):** Desenvolvido em **AdonisJS 6**, atua como a fonte da verdade. Gerencia duas frentes de autenticação:
    - _Usuários:_ Autenticação via Sessão/Cookie (Stateful) ou JWT.
    - _Agentes:_ Autenticação via Tokens Perpétuos (API Keys).
2.  **Frontend (Web):** Interface para alunos solicitarem uso e administradores gerenciarem o parque.
3.  **Agent (Máquinas Gerenciadas):** Software local (Daemon) que consulta a API para saber se deve permitir o uso ao hardware e reporta telemetria.

---

## 🚀 Funcionalidades (MVP)

### 👤 Usuários & Acesso

- **Autenticação Híbrida:** Login tradicional para usuários e "Handshake" seguro para os agentes instalados.
- **Role-Based Access Control (RBAC):** Diferenciação estrita entre `Student` e `Admin`.

### 📅 Alocação de Recursos (Modelo Otimista)

- **Aprovação Automática:** Visando agilidade no MVP, solicitações de alunos autenticados nascem com status `APPROVED`.
- **Controle Reativo:** O Administrador monitora alocações ativas e pode alterá-las para `DENIED`. Isso aciona o bloqueio imediato na máquina física via Agente.
- **Privacidade:** Alunos veem a ocupação do laboratório (mapa de máquinas), mas os dados de _quem_ está usando são anonimizados para não-admins.

### 🖥️ Gestão de Ativos & Telemetria

- **Sincronização de Estado:** O Agente consulta periodicamente ("Heartbeat") a API para alinhar o estado local (Bloqueado/Liberado).
- **Auditoria de Hardware:** Coleta de métricas (CPU/RAM) para identificar uso indevido ou máquinas ociosas.
- **Soft Deletes:** Preservação de histórico para auditoria.

---

## 🔌 API Endpoints

A API é segmentada por prefixos e versões para isolar a lógica de interação humana da lógica de automação das máquinas.

**Base URL:** `/api/v1` (Para rotas de interface)  
**Agent URL:** `/api/agent` (Para rotas de hardware)

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

Cadastrar máquina e gerar API Key para o agente.

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
    "latestTelemetry": {
      "cpuUsage": 250,
      "ramUsage": 450,
      "createdAt": "2026-01-28T12:00:00.000Z"
    }
  }
]
```

---

##### `GET /api/v1/machines/:id`

Detalhes técnicos de uma máquina específica.

**Permissão:** Admin

**Response (200):**

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
  "createdAt": "2026-01-28T12:00:00.000Z",
  "updatedAt": "2026-01-28T12:00:00.000Z"
}
```

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

**Response (200):** Máquina atualizada (mesmo formato do GET)

---

##### `DELETE /api/v1/machines/:id`

Remover máquina do sistema.

**Permissão:** Admin

**Response (200):**

```json
{
  "message": "Máquina removida com sucesso"
}
```

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

### 2. Rotas do Agente (`/api/agent`)

_Destinadas ao software embarcado nas máquinas. Requer Header `Authorization: Bearer <MACHINE_TOKEN>`._

---

##### `POST /api/agent/validate-access`

Validar se o token do agente é válido.

**Headers:**

```
Authorization: Bearer <MACHINE_TOKEN>
```

**Response (200):**

```json
{
  "valid": true,
  "machine": {
    "id": 1,
    "name": "PC-LAB-01",
    "status": "available"
  }
}
```

---

##### `POST /api/agent/telemetry`

Enviar pacote de métricas (CPU, RAM, Temp).

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
  "loggedUserName": "aluno.silva"
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

## 🛠 Tech Stack

- **Backend:** Node.js, AdonisJS 6, TypeScript.
- **Banco de Dados:** SQLite (Configurado com WAL Mode para alta concorrência).
- **Frontend:** (A definir).
- **Agent:** (A definir).

---

## 📦 Como Rodar
