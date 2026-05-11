# Frontend Web — Resumo Completo

> Aplicação Vue 3 SPA para gerenciamento de reservas de máquinas de laboratório.

---

## 1. Stack & Dependências

| Pacote | Versão | Função |
|--------|--------|--------|
| `vue` | ^3.5.25 | Framework UI |
| `vue-router` | ^4.6.4 | Roteamento |
| `pinia` | ^3.0.4 | Gerenciamento de estado |
| `axios` | ^1.13.5 | Cliente HTTP |
| `vite` | ^7.3.1 | Build tool / dev server |
| `typescript` | ~5.9.3 | Tipagem estática |

**Dev server:** porta `5173`, acessível pela rede (`host: true`).  
**Alias de path:** `@` → `src/`.  
**Variável de ambiente:** `VITE_API_URL=http://localhost:3333`.

---

## 2. Estrutura de Pastas

```
src/
├── App.vue                  # Root: apenas <RouterView />
├── main.ts                  # Inicializa Vue, Pinia, Router, timeSync
├── assets/main.css          # Estilos globais (glassmorphism dark)
├── components/
│   └── NewAllocationModal.vue
├── composables/
│   └── useTelemetryPlayback.ts
├── layouts/
│   └── AppLayout.vue        # Navbar + <RouterView /> + menu admin
├── router/index.ts          # Rotas + guards de navegação
├── services/
│   ├── api.ts               # Instância Axios + interceptors
│   └── timeSync.ts          # Sincronização de relógio com o servidor
├── stores/
│   ├── auth.ts              # Autenticação (JWT + localStorage)
│   ├── allocations.ts       # Reservas
│   ├── machines.ts          # Máquinas
│   └── users.ts             # Usuários
├── types/index.ts           # Interfaces TypeScript
└── views/
    ├── LoginView.vue
    ├── HomeView.vue         # Calendário semanal + reservas
    ├── MachinesView.vue     # Lista de máquinas
    ├── MachineDetailView.vue
    ├── ProfileView.vue
    └── admin/
        ├── AdminDashboardView.vue
        ├── AdminUsersView.vue
        ├── AdminMachinesView.vue
        ├── AdminMachineDetailView.vue
        └── AdminAllocationsView.vue
```

---

## 3. Roteamento (`router/index.ts`)

Todas as views são **lazy-loaded** com dynamic imports.

| Rota | View | Acesso |
|------|------|--------|
| `/login` | `LoginView` | Apenas visitantes não autenticados |
| `/` | `HomeView` | Autenticado (qualquer role) |
| `/machines` | `MachinesView` | Autenticado |
| `/machines/:id` | `MachineDetailView` | Autenticado |
| `/profile` | `ProfileView` | Autenticado |
| `/admin` | `AdminDashboardView` | `role === "admin"` |
| `/admin/users` | `AdminUsersView` | `role === "admin"` |
| `/admin/machines` | `AdminMachinesView` | `role === "admin"` |
| `/admin/machines/:id` | `AdminMachineDetailView` | `role === "admin"` |
| `/admin/allocations` | `AdminAllocationsView` | `role === "admin"` |

**Guards de navegação:**
- Hidrata o auth store do localStorage a cada mudança de rota.
- Usuário não autenticado → redireciona para `/login`.
- Usuário autenticado em `/login` → redireciona para `/`.
- Rota admin com role `user` → redireciona para `/`.

---

## 4. Stores (Pinia)

### 4.1 `auth.ts`
**Estado:** `user: User | null`, `token: string | null`  
**Computed:** `isAuthenticated`, `isAdmin`

| Action | Endpoint | Descrição |
|--------|----------|-----------|
| `loadFromStorage()` | — | Hidrata do localStorage |
| `login(email, password)` | `POST /api/v1/login` | Salva token + user |
| `logout()` | `DELETE /api/v1/logout` | Limpa localStorage |
| `fetchMe()` | `GET /api/v1/me` | Atualiza dados do usuário |
| `updateProfile(id, payload)` | `PUT /api/v1/users/{id}` | Edita perfil |

**Persistência:** `token` e `user` (JSON) no localStorage.

---

### 4.2 `allocations.ts`
**Estado:** `allocations: Allocation[]`, `loading: boolean`

| Action | Endpoint |
|--------|----------|
| `fetchAllocations(params?)` | `GET /api/v1/allocations` |
| `fetchUserAllocations(userId, params?)` | `GET /api/v1/users/{userId}/allocations` |
| `createAllocation(payload)` | `POST /api/v1/allocations` |
| `updateAllocation(id, payload)` | `PATCH /api/v1/allocations/{id}` |
| `cancelAllocation(id)` | `PATCH /api/v1/allocations/{id}` com `status: "cancelled"` |
| `fetchAllocationSummary(id)` | `GET /api/v1/allocations/{id}/summary` |
| `softDeleteAllocation(id)` | `DELETE /api/v1/allocations/{id}` |

---

### 4.3 `machines.ts`
**Estado:** `machines: Machine[]`, `loading: boolean`

| Action | Endpoint |
|--------|----------|
| `fetchMachines()` | `GET /api/v1/machines` |
| `fetchMachine(id)` | `GET /api/v1/machines/{id}` |
| `createMachine(payload)` | `POST /api/v1/machines` |
| `updateMachine(id, payload)` | `PUT /api/v1/machines/{id}` |
| `deleteMachine(id)` | `DELETE /api/v1/machines/{id}` |
| `fetchMachineAllocations(id, params?)` | `GET /api/v1/machines/{id}/allocations` |
| `regenerateToken(id)` | `POST /api/v1/machines/{id}/regenerate-token` |
| `fetchTelemetryStream(id, count?)` | `GET /api/v1/machines/{id}/telemetry/stream` |

---

### 4.4 `users.ts`
**Estado:** `users: User[]`, `loading: boolean`

| Action | Endpoint |
|--------|----------|
| `fetchUsers()` | `GET /api/v1/users` |
| `createUser(payload)` | `POST /api/v1/users` |
| `updateUser(id, payload)` | `PUT /api/v1/users/{id}` |
| `deleteUser(id)` | `DELETE /api/v1/users/{id}` |

---

## 5. Services

### 5.1 `api.ts` — Instância Axios
- Base URL: `VITE_API_URL` (padrão: `http://localhost:3333`)
- Timeout: 15 segundos
- Content-Type: `application/json`

**Interceptors:**
- **Request:** injeta `Authorization: Bearer {token}` automaticamente se existir token no localStorage.
- **Response 401:** limpa token/user do localStorage e redireciona para `/login`.

---

### 5.2 `timeSync.ts` — Sincronização de Relógio
**Problema resolvido:** garantir timestamps precisos para reservas em ambiente distribuído onde o relógio do browser pode estar dessincronizado.

**API exportada:**
```typescript
startTimeSync()   // inicia sync imediato + repetição a cada 5 min
stopTimeSync()    // cancela o intervalo
serverNowMs()     // timestamp UTC atual em ms (ajustado pelo offset)
serverNowISO()    // timestamp UTC atual como ISO string
isSynced()        // boolean: ao menos um sync bem-sucedido
getOffsetMs()     // offset calculado (server - local)
```

**Algoritmo:**
1. Registra `Date.now()` antes da request.
2. GET `/api/time` → `{ utc: string, unixMs: number }`.
3. Registra `Date.now()` após a response.
4. Calcula RTT e subtrai metade (latência estimada).
5. Guarda o offset para todas as chamadas subsequentes.

---

## 6. Composable: `useTelemetryPlayback`

**Propósito:** polling de telemetria em tempo real para views de máquina.

```typescript
const { current, isActive, start, stop } = useTelemetryPlayback(machineId)
```

- Inicia polling imediato + a cada **5 segundos**.
- `current` é do tipo `RealtimeTelemetry | null`.
- Para automaticamente no `onUnmounted`.
- Erros de fetch são silenciados (não interrompem o loop).

---

## 7. Layout: `AppLayout.vue`

Navbar fixa no topo com:
- Logo com gradiente
- Links de navegação com highlight na rota ativa
- Usuários admin veem itens extras: **Painel**, **Usuários**, **Gerenciar**, **Alocações**
- Nome do usuário logado + botão de logout
- Menu hambúrguer responsivo para mobile

Design: glassmorphism com backdrop-blur, tema dark.

---

## 8. Views — O que cada uma faz

### `LoginView`
Formulário de email/senha. Trata erros 400/401 ("credenciais inválidas") e 422 ("dados inválidos").

### `HomeView`
Calendário semanal (7 dias, horas 7–23). Navegação entre semanas. Filtro por máquina. Blocos de alocação com lógica de sobreposição (multi-coluna). Botão para criar nova reserva (abre `NewAllocationModal`). Admin vê nome do usuário nos blocos; usuário regular vê apenas o nome da máquina.

### `MachinesView`
Grid responsivo de cards de máquinas. Busca por nome/descrição/status. Badge de status colorido (disponível, ocupada, manutenção, offline). Clica no card para ir ao detalhe.

### `MachineDetailView`
Info da máquina (CPU, GPU, RAM, Disco, IP — MAC apenas para admin). Telemetria em tempo real via polling (progress bars coloridas por threshold: <50% verde, <80% amarelo, >80% vermelho). Calendário semanal restrito à máquina. Botão de reserva (desabilitado se em manutenção).

### `ProfileView`
Edição de nome, email, senha (opcional). Avatar com iniciais. Badge de role. Data de criação da conta.

### `AdminDashboardView`
Cards de estatísticas: total de máquinas / online, usuários, reservas pendentes, ativas. Grid de máquinas com status dot + telemetria resumida + usuário logado. Auto-refresh: máquinas a cada 10s, alocações a cada 30s.

### `AdminUsersView`
Tabela de usuários com busca. CRUD completo via modals. Na criação, senha é obrigatória; na edição, deixar em branco mantém a senha atual. Seleção de role apenas na criação.

### `AdminMachinesView`
Tabela de máquinas com busca. CRUD completo via modals. Regenerar token (confirmação + exibe token gerado). Formulário: nome, descrição, endereço MAC, status (só na edição).

### `AdminMachineDetailView`
Telemetria ao vivo em grid com valores coloridos. Tabela das últimas 20 alocações com ações de aprovar/negar/cancelar. Auto-refresh de alocações a cada 30s.

### `AdminAllocationsView`
Todas as alocações do sistema. Busca por máquina, usuário, motivo. Abas de filtro: Todas, Pendente, Aprovada, Negada, Finalizada, Cancelada. Ações de aprovar/negar/cancelar com confirmação.

---

## 9. Componente: `NewAllocationModal`

**Props:** `machines: Machine[]`  
**Emits:** `close`, `created`

- Filtra máquinas em manutenção da lista.
- Campos: Máquina (select), Data, Hora início, Hora fim, Motivo (textarea).
- Valida: todos os campos obrigatórios, início < fim.
- Converte data/hora local para UTC ISO antes de enviar.
- Erro 409 → mostra mensagem de conflito de horário.
- Erro 422 → mostra mensagem de validação.

---

## 10. Tipos TypeScript (`types/index.ts`)

```typescript
User {
  id, fullName, email,
  role: 'user' | 'admin',
  createdAt, updatedAt
}

Machine {
  id, name, description,
  cpuModel, gpuModel, totalRamGb, totalDiskGb,
  ipAddress, macAddress,
  status: 'available' | 'occupied' | 'maintenance' | 'offline',
  lastSeenAt, loggedUser, createdAt, updatedAt,
  token, latestTelemetry
}

RealtimeTelemetry {
  cpuUsage, cpuTemp, gpuUsage, gpuTemp,
  ramUsage, diskUsage, moboTemperature,
  downloadUsage, uploadUsage, timestamp
}

Allocation {
  id, userId, machineId,
  startTime, endTime, reason,
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'finished',
  userHidden, createdAt, updatedAt,
  user, machine, metric
}

AllocationMetric {
  id, allocationId,
  avgCpuUsage, maxCpuUsage, avgCpuTemp, maxCpuTemp,
  avgGpuUsage, maxGpuUsage, avgGpuTemp, maxGpuTemp,
  avgRamUsage, maxRamUsage, avgDiskUsage, maxDiskUsage,
  sessionDurationMinutes, createdAt, updatedAt
}

PaginatedResponse<T> {
  meta: { total, perPage, currentPage, lastPage, firstPage },
  data: T[]
}
```

---

## 11. Sistema de Estilos (`assets/main.css`)

**Tema:** Dark glassmorphism, inspirado no design Apple.

**Variáveis CSS principais:**
| Variável | Valor | Uso |
|----------|-------|-----|
| `--bg-primary` | `#08080f` | Fundo da página |
| `--bg-secondary` | `#0d0d18` | Fundo secundário |
| `--bg-card` | semi-transparente | Cards com blur |
| `--bg-card-solid` | `#111119` | Cards sólidos |
| `--accent` | `#7c6cf0` | Cor de ênfase (roxo) |
| `--text-primary` | `#f0f0f5` | Texto principal |
| `--text-secondary` | `#9595b0` | Texto secundário |
| `--text-muted` | `#555570` | Texto fraco |
| `--success` | verde | Status disponível/aprovado |
| `--warning` | âmbar | Status ocupado/pendente |
| `--danger` | vermelho | Status offline/negado |
| `--info` | azul | Status manutenção |

**Efeitos:** backdrop-blur, transições 200ms cubic-bezier, gradientes de acento.

---

## 12. Fluxos Principais

### Login
```
LoginView → auth.login() → POST /api/v1/login
→ salva token/user no localStorage
→ router guard libera rotas
→ redireciona para /
```

### Criar Reserva
```
+ Reservar → NewAllocationModal abre
→ preenche máquina, data, hora início/fim, motivo
→ converte para UTC → POST /api/v1/allocations
→ sucesso: reload do calendário, modal fecha
→ 409: exibe erro de conflito
→ 422: exibe erro de validação
```

### Telemetria em Tempo Real
```
mount da view → useTelemetryPlayback.start()
→ fetch imediato + a cada 5s
→ GET /api/v1/machines/{id}/telemetry/stream?count=1
→ current.value atualizado → UI reage reativamente
→ unmount → polling para automaticamente
```

### Ação de Admin sobre Alocação
```
Tabela de alocações → clica Aprovar/Negar/Cancelar
→ confirmação → allocations.updateAllocation(id, { status })
→ PATCH /api/v1/allocations/{id}
→ reload da lista
```

---

## 13. Pontos de Atenção

- **Timezone:** todos os timestamps enviados à API são UTC. O `timeSync.ts` garante que o offset do browser não distorça os horários.
- **Role admin:** verificado tanto no router guard (frontend) quanto na API (backend).
- **Token JWT:** armazenado no localStorage; interceptor do Axios injeta em todas as requests automaticamente; 401 limpa o estado e redireciona.
- **Conflito de reserva:** a API retorna 409; o front exibe mensagem amigável sem travar o formulário.
- **Máquina em manutenção:** botão de reserva fica desabilitado no `MachineDetailView`; o select do modal filtra essas máquinas.
- **Polling vs WebSocket:** o projeto usa polling (5s para telemetria, 10–30s para listas) em vez de WebSocket. Suficiente para o caso de uso atual, mas representa um ponto de evolução.
