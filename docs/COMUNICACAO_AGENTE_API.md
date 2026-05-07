# Comunicação Agente ↔ API — Rotas, Contratos e Análise

## Como o agente se autentica

Todo request do agente carrega **dois** headers obrigatórios:

```
Authorization: Bearer <MACHINE_TOKEN>
X-Machine-Mac:  AA:BB:CC:DD:EE:FF
```

O middleware `MachineAuthMiddleware` valida ambos em sequência:

1. Extrai o token do header `Authorization`
2. Verifica o token em cache (TTL 5min) ou no banco
3. Compara o MAC do header com o MAC registrado no banco para **aquela mesma máquina**
4. Se ambos batem, injeta o objeto `machine` no contexto HTTP (`ctx.authenticatedMachine`)

Esse modelo é um **fator duplo de autenticação de máquina**: o token prova "sei o segredo", o MAC prova "sou este hardware específico". Um token vazado de outra máquina não autentica numa máquina diferente.

---

## Mapa completo das rotas do agente

Prefixo base: `POST|GET|PUT /api/agent/*`
Middleware: `machineAuth()` em todas.

```
POST   /api/agent/heartbeat          → AgentController.heartbeat
POST   /api/agent/validate-user      → AgentController.validateUser
GET    /api/agent/day-schedule       → AgentController.daySchedule
POST   /api/agent/quick-allocate     → AgentController.quickAllocate
POST   /api/agent/report-login       → AgentController.reportLogin
POST   /api/agent/report-logout      → AgentController.reportLogout
PUT    /api/agent/sync-specs         → AgentController.syncSpecs
POST   /api/agent/telemetry          → AgentController.telemetry
GET    /api/agent/ssh/pending        → AgentController.sshPendingRequests
POST   /api/agent/ssh/setup          → AgentController.sshSetupReport
POST   /api/agent/ssh/teardown       → AgentController.sshTeardownReport
```

---

## Detalhamento de cada rota

---

### `POST /api/agent/heartbeat`

**Propósito**: rota de polling principal. O agente chama a cada ~30s para atualizar o último contato e receber o estado atual da alocação.

**Request** — query param opcional:
```
?loggedUserId=42    # ID do usuário atualmente logado no SO
```
Sem body.

**Response `200`**:
```json
{
  "machine": { "id": 1, "name": "srv-01", "status": "occupied" },
  "currentAllocation": {
    "id": 7,
    "userId": 42,
    "userName": "João Silva",
    "userEmail": "joao@lab.br",
    "startTime": "2026-05-06T08:00:00.000Z",
    "endTime":   "2026-05-06T18:00:00.000Z",
    "remainingMinutes": 320
  },
  "nextAllocation": {
    "startTime": "2026-05-07T09:00:00.000Z",
    "endTime":   "2026-05-07T17:00:00.000Z",
    "minutesUntilStart": 900
  },
  "quickAllocate": {
    "allowed": false,
    "maxDurationMinutes": 0,
    "minGapMinutes": 20,
    "reason": "Próxima alocação em 15 minutos (mínimo: 20)"
  },
  "shouldBlock": false,
  "blockReason": null,
  "serverTime": "2026-05-06T12:40:00.000Z"
}
```

**O que o agente faz com esta resposta**:
- Se `shouldBlock: true` → aciona bloqueio de tela / encerra sessão SSH
- Se `currentAllocation` mudou de `null` para objeto → aplica cgroups para o novo dono
- Se `currentAllocation` voltou a `null` → revoga SSH e reseta cgroups
- `serverTime` pode ser usado para detectar desvio de relógio entre agente e API

**Efeitos colaterais na API**:
- Atualiza `machine.lastSeenAt`
- Se `machine.status === 'offline'` → muda para `'available'`
- Se `currentAllocation === null && machine.status === 'occupied'` → corrige status para `'available'`

---

### `POST /api/agent/validate-user`

**Propósito**: valida email + senha de um usuário e verifica se ele tem alocação ativa **nesta máquina agora**. Usado quando o usuário digita credenciais na tela de login local do agente (fluxo de login físico, não SSH).

**Request body**:
```json
{ "email": "joao@lab.br", "password": "senha123" }
```

**Responses**:

| Condição | HTTP | `allowed` | `reason` |
|---|---|---|---|
| Credenciais inválidas | 401 | false | `INVALID_CREDENTIALS` |
| Máquina em manutenção | 200 | false | `MACHINE_MAINTENANCE` |
| Sem alocação ativa | 200 | false | `NO_ACTIVE_ALLOCATION` |
| Autorizado | 200 | true | `AUTHORIZED` |

```json
// Resposta de sucesso
{
  "allowed": true,
  "reason": "AUTHORIZED",
  "user": { "id": 42, "fullName": "João Silva", "email": "joao@lab.br", "role": "user" },
  "allocation": {
    "id": 7,
    "startTime": "...",
    "endTime": "...",
    "remainingMinutes": 320
  }
}
```

> **Nota de segurança**: senhas são transmitidas em plaintext no corpo do request. A comunicação **deve** ocorrer sobre HTTPS em produção. Dentro de rede de laboratório isolada isso é aceitável para MVP, mas precisa ser revisado antes de expor à internet.

---

### `GET /api/agent/day-schedule`

**Propósito**: agenda do dia para exibir na tela de login local do agente. Retorna **somente horários** — sem nome ou email dos usuários.

**Query params opcionais**:
```
?date=2026-05-07          # data específica (padrão: hoje)
?tz=America/Sao_Paulo     # fuso horário para delimitação do "dia" (padrão: UTC)
```

**Response `200`**:
```json
{
  "machineId": 1,
  "machineName": "srv-01",
  "date": "2026-05-06",
  "slots": [
    {
      "startTime": "2026-05-06T08:00:00.000Z",
      "endTime":   "2026-05-06T18:00:00.000Z",
      "isCurrent": true,
      "isPast": false
    }
  ]
}
```

---

### `POST /api/agent/quick-allocate`

**Propósito**: cria uma alocação instantânea ("on the spot") se houver janela disponível. O usuário usa a tela de login local para se alocar sem precisar acessar o sistema web.

**Regras de negócio validadas pela API**:
- Deve haver ≥ 20 minutos até a próxima alocação
- Duração automática: até 120 minutos, ou `minutesUntilNext - 5` se houver próxima alocação
- Duração mínima: 10 minutos
- Sem alocação ativa no momento

**Request body**:
```json
{
  "email": "joao@lab.br",
  "password": "senha123",
  "durationMinutes": 60    // opcional, padrão 120
}
```

**Response `201`**:
```json
{
  "success": true,
  "reason": "ALLOCATION_CREATED",
  "message": "Alocação criada com sucesso! Você tem 60 minutos.",
  "allocation": { "id": 8, "startTime": "...", "endTime": "...", "durationMinutes": 60 },
  "user": { "id": 42, "fullName": "João Silva", "email": "joao@lab.br" }
}
```

---

### `POST /api/agent/report-login`

**Propósito**: informa à API que um usuário logou fisicamente no SO da máquina. Muda `machine.status` para `occupied` e registra o `loggedUser`.

**Request body**:
```json
{ "username": "joao_silva" }   // username do sistema operacional
```

**Response `200`**: `{ "registered": true, "message": "Login de 'joao_silva' registrado." }`

---

### `POST /api/agent/report-logout`

**Propósito**: informa que o usuário deslogou. Muda `machine.status` para `available`, limpa `loggedUser`.

**Request**: sem body.

**Response `200`**: `{ "registered": true, "message": "Logout de 'joao_silva' registrado." }`

---

### `PUT /api/agent/sync-specs`

**Propósito**: sincroniza as especificações de hardware detectadas pelo agente. Chamado uma vez na inicialização do daemon.

**Request body** (todos opcionais):
```json
{
  "cpuModel": "Intel Core i9-14900K",
  "gpuModel": "NVIDIA GeForce RTX 4090",
  "totalRamGb": 128,
  "totalDiskGb": 4000,
  "ipAddress": "192.168.1.10"
}
```

> `macAddress` **não** é sincronizável — é definido na criação da máquina pelo admin e usado como fator de autenticação. Alterá-lo via agente seria uma brecha de segurança.

**Response `200`**: ecoa os campos atualizados.

---

### `POST /api/agent/telemetry`

**Propósito**: envia snapshot de métricas de hardware. O agente chama a cada 5s (no plano novo: a API agrega em janelas de 60s antes de persistir).

**Request body** (campos obrigatórios + opcionais):
```json
{
  "cpuUsage":        650,   // obrigatório — 0-1000 (= 65.0%)
  "cpuTemp":         720,   // obrigatório — 0-1500 (= 72.0°C)
  "gpuUsage":        200,   // obrigatório — 0-1000
  "gpuTemp":         550,   // obrigatório — 0-1500
  "ramUsage":        480,   // obrigatório — 0-1000
  "diskUsage":       300,   // opcional   — 0-1000
  "downloadUsage":  45.2,   // opcional   — Mbps (float, sem escala)
  "uploadUsage":    10.1,   // opcional   — Mbps
  "moboTemperature": 400,   // opcional   — 0-1500
  "loggedUserName": "joao_silva"  // obrigatório — auditoria
}
```

**Convenção de escala**:
- Percentuais (uso, ocupação): `valor_real × 10` → int. Ex: 65.3% → `653`
- Temperaturas (°C): `valor_real × 10` → int. Ex: 72.5°C → `725`
- Rede: float em Mbps direto (sem escala)
- Watts, MHz, KB/s (novos campos planejados): valor direto sem escala

**Comportamento da API**:
- Sempre atualiza o estado em memória (real-time buffer) — usado pelo SSE do dashboard
- Persiste no banco **somente** se houver alocação ativa no momento

**Response**: `204 No Content`

---

### `GET /api/agent/ssh/pending`

**Propósito**: polling para detectar pedidos de acesso SSH feitos pelo frontend. O agente chama a cada 5s.

**Response `200`**:
```json
{
  "pending": [
    {
      "sessionId": 3,
      "allocationId": 7,
      "userId": 42,
      "userEmail": "joao@lab.br",
      "userName": "João Silva",
      "systemUsername": "joao_silva",
      "endTime": "2026-05-06T18:00:00.000Z"
    }
  ]
}
```

Quando `pending` é array não-vazio, o agente deve:
1. Gerar par de chaves ed25519 com `ssh-keygen`
2. Instalar a chave pública em `/home/<systemUsername>/.ssh/authorized_keys`
3. Chamar `POST /api/agent/ssh/setup` com a chave privada

---

### `POST /api/agent/ssh/setup`

**Propósito**: o agente reporta que gerou e instalou a chave SSH. Envia a chave privada para que a API a entregue ao frontend (via in-memory store com TTL de 5min).

**Request body**:
```json
{
  "allocationId":          7,
  "systemUsername":        "joao_silva",
  "publicKeyFingerprint":  "SHA256:abc123...",
  "privateKey":            "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

**Response `200`**: `{ "success": true, "sessionId": 3 }`

> A chave privada **nunca é persistida no banco**. Ela vive apenas em memória na API por 5 minutos — tempo suficiente para o frontend buscá-la. Após isso, o usuário precisa solicitar nova sessão.

---

### `POST /api/agent/ssh/teardown`

**Propósito**: o agente informa que removeu a chave pública do `authorized_keys` (cleanup ao fim da alocação).

**Request body**:
```json
{ "allocationId": 7 }
```

**Response `200`**: `{ "success": true, "revokedCount": 1 }`

---

## Fluxo completo de uma sessão SSH

```
Frontend                  API                        Agente
   |                       |                            |
   |-- POST /allocations/:id/ssh-access -->             |
   |                       |-- cria SshSession          |
   |                       |   (sem fingerprint)        |
   |                       |                            |
   |                       |<-- GET /ssh/pending (5s) --|
   |                       |-- retorna sessão pendente  |
   |                       |                            |
   |                       |   gera ed25519 keypair     |
   |                       |   instala pubkey           |
   |                       |<-- POST /ssh/setup --------|
   |                       |   (envia private key)      |
   |                       |-- armazena em memória      |
   |                       |   (TTL 5min)               |
   |                       |                            |
   |<-- GET /allocations/:id/ssh-access (retry) --------|
   |   retorna { status: "ready", privateKey, ip }      |
   |                       |                            |
   SSH connect (port 22)   |                            |
   |--------------------------------------------->      |
   |                       |                            |
   fim da alocação         |                            |
   |                       |<-- POST /ssh/teardown -----|
   |                       |-- marca sessão revoked     |
```

---

## O que está bem implementado

**Autenticação dupla (token + MAC)** — Excelente decisão de design. Impede que um token comprometido de uma máquina seja reutilizado em outra. O cache com TTL de 5min no `MachineCache` evita consultas repetidas ao banco em cada request de telemetria (que chega a 12 req/min por máquina).

**Separação clara de responsabilidades nos validators** — `agent.ts` e `telemetry.ts` são separados. Cada validator valida apenas o que precisa. O uso de `vine.compile()` pré-compila os schemas uma vez, não a cada request — prática correta para performance.

**`shouldBlock` consolidado no heartbeat** — Em vez de ter um endpoint `/should-block` separado, a resposta do heartbeat já contém tudo que o agente precisa para tomar decisões de controle. Reduz round-trips e simplifica o agente.

**Telemetria com estado real-time separado da persistência** — O buffer nunca bloqueia o request de telemetria: dados vão para memória imediatamente e o flush para o banco ocorre em background. `response.noContent()` é retornado sem esperar o banco.

**Chave privada SSH nunca toca o banco** — O `SshKeyStore` em memória com TTL e auto-cleanup via `setTimeout` é correto. A chave existe por no máximo 5 minutos. Após isso, ela desaparece automaticamente.

**Privacy por design no `day-schedule`** — A agenda do dia não expõe nome, email ou ID do usuário — apenas janelas de horário. Correto para exibição numa tela de login pública.

---

## Melhorias para um sistema industrial

### 1. `sshPendingRequests` tem lógica morta e é frágil

O método tem **duas implementações paralelas** para encontrar sessões pendentes: uma baseada em `alloc.$extras._sshRequested` (campo que nunca existe na prática) e outra baseada em `SshSession` com `publicKeyFingerprint IS NULL`. Apenas a segunda funciona.

A primeira metade do método produz sempre um array vazio e deveria ser removida para evitar confusão. O código atual faz **N+1 queries** (1 por sessão pendente para buscar a alocação associada). Para poucas sessões simultâneas isso é tolerável, mas é um antipadrão.

**Correção**: remover o bloco morto, adicionar `.preload('allocation', q => q.preload('user'))` para resolver em 2 queries.

### 2. Senhas trafegam em plaintext

`validate-user` e `quick-allocate` recebem `{ email, password }` no body. Para MVP em rede isolada é tolerável, mas **HTTPS é obrigatório** antes de qualquer exposição externa. Os validators deveriam incluir um comentário explícito sobre esse requisito.

### 3. `heartbeat` faz até 3 queries ao banco por chamada

Dentro do heartbeat: `findCurrentAllocation` (1 query + N rows carregados), `findNextAllocation` (outra query + N rows), mais um possível `machine.save()`. Com 10 servidores a cada 30s isso são 60 queries/min só de heartbeat.

**Melhoria**: adicionar índice composto em `allocations(machine_id, status, start_time, end_time)` e usar query SQL com `WHERE` de intervalo de tempo diretamente no banco em vez de carregar todos e filtrar em JS.

### 4. `sshKeyStore` está dentro do controller (arquivo)

A classe `SshKeyStore` está declarada no final de `agent_controller.ts` e exportada como singleton. Isso funciona, mas mistura infraestrutura com controller. O correto seria movê-la para `app/services/ssh_key_store.ts` — consistente com `machine_cache.ts` e `telemetry_buffer.ts`.

### 5. Falta de retry explícito documentado

A API não documenta qual comportamento espera do agente em caso de falha de rede. O agente atual descarta silenciosamente. Para operações críticas (SSH setup/teardown) o contrato deveria ser: "se o agente não receber `200` em `/ssh/setup`, ele deve tentar novamente até N vezes antes de revogar a chave localmente".

### 6. `report-login` não valida consistência com a alocação

O agente pode chamar `report-login` com qualquer `username` string. A API aceita sem verificar se existe uma alocação ativa para aquele username. Idealmente, o login deveria ser vinculado ao `allocationId` da sessão ativa, criando rastreabilidade auditável.

### 7. `sync-specs` não tem idempotência garantida

`PUT /api/agent/sync-specs` usa `machine.merge(data)` + `save()`. Se o agente reiniciar e reenvier as specs, isso sobrescreve os valores — o que é o comportamento correto. Porém, o validator aceita todos os campos como `optional()`, então um bug no agente poderia enviar specs parciais e apagar campos anteriormente válidos. **Melhoria**: ignorar campos `undefined`/`null` no merge (não sobrescrever com null se a spec atual é válida).

### 8. Ausência de versionamento nas rotas do agente

As rotas do frontend são `/api/v1/...`, mas as do agente são `/api/agent/...` sem versão. Se o contrato do agente precisar mudar incompativelmente, não há como manter compatibilidade com agentes antigos que ainda não foram atualizados. **Sugestão**: `/api/agent/v1/...` para ter a opção futura de `/api/agent/v2/...`.
