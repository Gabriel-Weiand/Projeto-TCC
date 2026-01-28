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

Detalhes técnicos de uma máquina específica. **Inclui o token para configuração do agente.**

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

#### 🔄 Ciclo de Vida do Agente (Polling)

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
│   │                                                                  │          │
│   │   A cada 30s:  POST /heartbeat                                   │          │
│   │                └─ Mantém status online                           │          │
│   │                └─ Recebe se deve bloquear                        │          │
│   │                └─ Recebe alocação atual (se houver)              │          │
│   │                                                                  │          │
│   │   A cada 10s:  POST /telemetry                                   │          │
│   │                └─ Envia métricas CPU/RAM/GPU/Temp                 │          │
│   │                                                                  │          │
│   └──────────────────────────────────────────────────────────────────┘          │
│                              │                                                  │
│                              ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │              QUANDO USUÁRIO TENTA LOGAR NO SO                    │          │
│   │                                                                  │          │
│   │   1. POST /validate-user {email, password}                       │          │
│   │      └─ allowed: true  → Permite login                           │          │
│   │      └─ allowed: false → Bloqueia e mostra mensagem              │          │
│   │                                                                  │          │
│   │   2. Se permitiu → POST /report-login {username}                 │          │
│   │      └─ Registra quem logou para auditoria                       │          │
│   │                                                                  │          │
│   └──────────────────────────────────────────────────────────────────┘          │
│                              │                                                  │
│                              ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │              DURANTE A SESSÃO DO USUÁRIO                         │          │
│   │                                                                  │          │
│   │   A cada 60s:  GET /should-block?loggedUserId=123                │          │
│   │                └─ shouldBlock: true  → Força logout              │          │
│   │                └─ shouldBlock: false → Continua                  │          │
│   │                └─ remainingMinutes: 15 → Avisa usuário           │          │
│   │                                                                  │          │
│   └──────────────────────────────────────────────────────────────────┘          │
│                              │                                                  │
│                              ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │              QUANDO USUÁRIO FAZ LOGOUT                           │          │
│   │                                                                  │          │
│   │   POST /report-logout                                            │          │
│   │   └─ Libera a máquina para o próximo                             │          │
│   │                                                                  │          │
│   └──────────────────────────────────────────────────────────────────┘          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

#### Intervalos Recomendados de Polling

| Rota              | Intervalo | Descrição                            |
| :---------------- | :-------- | :----------------------------------- |
| `/heartbeat`      | 30s       | Manter online + status de bloqueio   |
| `/telemetry`      | 10s       | Métricas de hardware                 |
| `/should-block`   | 60s       | Verificar se alocação foi revogada   |
| `/validate-user`  | Sob demanda | Quando usuário tenta logar         |
| `/report-login`   | Sob demanda | Após login bem-sucedido            |
| `/report-logout`  | Sob demanda | Quando usuário sai                 |
| `/allocations`    | Sob demanda | Consultar agenda da máquina        |
| `/current-session`| Sob demanda | Quem deveria estar usando          |
| `/sync-specs`     | No boot   | Atualizar specs detectadas           |

---

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

| Campo              | Tipo    | Descrição                                      |
| :----------------- | :------ | :--------------------------------------------- |
| `machine`          | object  | Dados da máquina                               |
| `currentAllocation`| object? | Alocação ativa no momento (null se livre)      |
| `shouldBlock`      | boolean | Se true, bloquear a máquina imediatamente      |
| `serverTime`       | string  | Hora do servidor (para sincronização)          |

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
| Código                  | Descrição                                |
| :---------------------- | :--------------------------------------- |
| `AUTHORIZED`            | Usuário tem alocação ativa - permitir    |
| `NO_ACTIVE_ALLOCATION`  | Sem alocação para este horário           |
| `INVALID_CREDENTIALS`   | Email/senha incorretos                   |
| `MACHINE_MAINTENANCE`   | Máquina em manutenção                    |

---

##### `GET /api/agent/should-block`

Verifica se o agente deve bloquear a máquina (polling durante sessão).

**Headers:**
```
Authorization: Bearer <MACHINE_TOKEN>
```

**Query Params:**
| Param          | Tipo   | Obrigatório | Descrição                    |
| :------------- | :----- | :---------- | :--------------------------- |
| `loggedUserId` | number | ❌          | ID do usuário logado no SO   |

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
| Código                       | Descrição                                |
| :--------------------------- | :--------------------------------------- |
| `VALID_ALLOCATION`           | Alocação válida - não bloquear           |
| `ALLOCATION_EXPIRED_OR_REVOKED` | Alocação expirou/cancelada - bloquear |
| `MACHINE_MAINTENANCE`        | Admin colocou em manutenção - bloquear   |

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

| Campo        | Tipo   | Obrigatório | Descrição                               |
| :----------- | :----- | :---------- | :-------------------------------------- |
| `cpuModel`   | string | ❌          | Modelo do processador                   |
| `gpuModel`   | string | ❌          | Modelo da GPU                           |
| `totalRamGb` | number | ❌          | RAM total em GB                         |
| `totalDiskGb`| number | ❌          | Disco total em GB                       |
| `ipAddress`  | string | ❌          | Endereço IP atual                       |
| `macAddress` | string | ❌          | MAC Address (formato: `AA:BB:CC:DD:EE:FF`) |

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

### 3. Configuração do Agente

#### Arquivo de Configuração

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
  block_on_no_allocation: true  # Bloquear se não houver alocação?
  warn_before_expire_minutes: 15  # Avisar X minutos antes de expirar
  force_logout_on_expire: true  # Forçar logout quando alocação expirar?
```

#### Processo de Setup

1. **Admin cria máquina** via `POST /api/v1/machines` ou interface web
2. **Admin copia o token** retornado na criação (ou via `GET /api/v1/machines/:id`)
3. **Admin instala o agente** na máquina física
4. **Admin configura o token** no arquivo de config do agente
5. **Agente inicia** e faz `PUT /sync-specs` + `POST /heartbeat`
6. **Máquina fica online** e pronta para uso

#### Rotação de Token (Segurança)

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

## 🛠 Tech Stack

- **Backend:** Node.js, AdonisJS 6, TypeScript.
- **Banco de Dados:** SQLite (Configurado com WAL Mode para alta concorrência).
- **Frontend:** (A definir).
- **Agent:** (A definir).

---

## 📦 Como Rodar
