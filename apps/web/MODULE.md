# Módulo Web

SPA Vue 3 para reservas, monitoramento de máquinas e administração do laboratório.

**Stack:** Vue 3 · TypeScript · Vite · Pinia · Vue Router · Axios · Chart.js

---

## Papel

- Alunos: calendário Gantt, criar/cancelar/estender reservas, conectar SSH, ver resumos de sessão.
- Admins: parque, usuários, alocações, telemetria, manutenção e políticas do lab.

Comunicação REST com a API em `/api/v1` (Bearer token). Bootstrap público via `GET /api/config` (fuso, calendário, flags de alocação).

---

## Como rodar

```bash
cd apps/web
npm install
echo "VITE_API_URL=http://localhost:3333" > .env
npm run dev
```

Requisito: **Node.js 22.x** (mesma versão da API). API rodando antes do front.

Guia rápido de uso e seed: [`README.md`](README.md).

---

## Rotas (`src/router/index.ts`)

| Rota | View | Auth |
|------|------|------|
| `/login` | `LoginView` | Pública |
| `/` | `HomeView` | User — calendário Gantt + nova reserva |
| `/my-allocations` | `MyAllocationsView` | User |
| `/machines` | `MachinesView` | User |
| `/machines/:id` | `MachineDetailView` | User |
| `/profile` | `ProfileView` | User |
| `/admin` | `AdminDashboardView` | Admin |
| `/admin/users` | `AdminUsersView` | Admin |
| `/admin/machines` | `AdminMachinesView` | Admin |
| `/admin/machines/:id` | → redirect `MachineDetailView?from=admin` | Admin |
| `/admin/machines/:id/edit` | `AdminMachineEditView` | Admin |
| `/admin/allocations` | `AdminAllocationsView` | Admin |
| `/admin/maintenance` | `AdminMaintenanceView` | Admin |
| `/admin/lab-telemetry` | → redirect maintenance `?tab=telemetria` | Admin |

Layout: `AppLayout.vue` (navbar, sino de notificações, abas admin).

---

## Stores (Pinia)

| Store | Responsabilidade |
|-------|------------------|
| `auth` | Login, token, `/me` |
| `allocations` | CRUD reservas, minhas alocações |
| `machines` | Listagem, detalhe, telemetria |
| `users` | Lista de usuários (admin) |
| `notifications` | Inbox, marcar lida |
| `labConfig` | Cache de `GET /api/config` |
| `machineGroups` | Grupos de máquinas (admin) |
| `systemMaintenance` | Prune, manutenção em lote |

---

## Horários e fuso

| Camada | Formato |
|--------|---------|
| API / banco | **UTC** (`…Z`) |
| Inputs de data/hora | Relógio de parede no fuso do lab (`labConfig.timezone`, ex. `America/Sao_Paulo`) |
| Gantt, tabelas, modais | `formatLabDateTime` / `parseApiUtc` |

Utilitário central: `src/utils/datetime.ts`

| Função | Uso |
|--------|-----|
| `wallClockToUtcIso` | Enviar início/fim de reserva |
| `formatLabDateTime` | Exibir instantes da API |
| `LabWallClockDateInput` / `LabWallClockTimeInput` | Campos dd/mm/aaaa e hh:mm |

**Regra:** nunca enviar datetime sem `Z`; nunca exibir ISO UTC cru sem converter para o fuso do lab.

Teste: `node apps/web/src/utils/datetime.spec.mjs`

Sincronização de relógio: `src/utils/timeSync.ts` + `GET /api/time` (offset ms; não substitui conversão de fuso).

---

## Componentes principais

| Área | Componentes |
|------|-------------|
| Reservas | `CalendarGanttScroll`, `ReservationFormFields`, `ReservationMachinePicker`, `ExtendAllocationOverlay` |
| Máquinas | `MachineLiveSections`, `MachineTelemetryPanel`, `AdminMachine*Tab` |
| SSH | `ProfileAllocationConnectModal`, chave no perfil |
| Notificações | `NotificationsPanel` |
| Admin manutenção | `AdminMaintenance*Tab`, `AdminTabBar` |
| Datetime | `LabWallClockDateInput`, `LabWallClockTimeInput` |

---

## Notificações (inbox)

A API gera eventos; o front lista e marca como lidas (`stores/notifications.ts`).

### Usuário

| Título (API) | Quando |
|--------------|--------|
| Reserva aprovada / negada / cancelada | Mudança de status |
| Reserva cancelada (manutenção) | Máquina em manutenção |
| Reserva em breve | ~10 min antes do início |
| Chave SSH — reserva em 5 min / iniciada | Sem chave ed25519 no perfil |
| Sessão encerrada | Auto-finalize |
| Resumo da sessão disponível | Admin gerou métricas |
| Cadastre sua chave SSH | Conta criada pelo admin |

### Admin

| Título (API) | Quando |
|--------------|--------|
| Nova reserva pendente | `LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL=true` |
| Possível flood SSH | Muitas falhas na janela |
| Agente offline | Sem heartbeat >10 min (cooldown 24 h) |

---

## SSH e conexão

- Usuário cadastra chave **ed25519** no perfil.
- Com alocação ativa: `ProfileAllocationConnectModal` mostra IP, porta, login (`systemUsername`), comando (`utils/ssh.ts`).
- Admin configura IP/porta SSH da máquina; auditoria em `/admin` → tentativas SSH.

---

## API e interceptors

- `src/services/api.ts` — Axios, base URL `VITE_API_URL`, header `Authorization`.
- Resposta de login: `{ value, user }` (token em `value`).
- Roles: `user` | `admin`.

---

## Estilos

Tema escuro em `src/assets/main.css` (variáveis CSS `--bg-*`, `--text-*`, `--border`).

---

## Referências

- Contratos e endpoints: [`apps/api/MODULE.md`](../api/MODULE.md)
- Agente e fases de acesso: [`apps/agent/MODULE.md`](../agent/MODULE.md)
