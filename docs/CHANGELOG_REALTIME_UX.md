# Changelog — Melhorias de Tempo Real, UX e Sincronização

Data: Junho 2025

---

## 1. Dashboard Administrativo com Auto-Refresh

**Arquivo:** `apps/web/src/views/admin/AdminDashboardView.vue`

**Problema:** O painel administrativo não atualizava automaticamente os dados de telemetria, status das máquinas e contagem de alocações. O administrador precisava pressionar F5 manualmente para ver dados atualizados.

**Solução:**

- Adicionado polling automático via `setInterval` no `onMounted`:
  - **Máquinas + telemetria**: atualizam a cada **10 segundos**
  - **Alocações**: atualizam a cada **30 segundos** (ciclo de 3 ticks)
- Cleanup automático no `onUnmounted` para evitar memory leaks
- Erros de rede durante o refresh são silenciados (não impactam a UX)

---

## 2. Alocação Rápida com Duração Personalizada

**Arquivos:**

- `apps/agent/screen_lock.py` (UI do agente)

**Problema:** A alocação rápida usava automaticamente a duração máxima disponível, sem permitir que o usuário escolhesse quanto tempo desejava.

**Solução:**

- Adicionado seletor de duração (`CTkOptionMenu`) com presets: 15, 30, 45, 60, 90 e 120 minutos
- As opções são filtradas automaticamente pelo tempo máximo disponível (calculado pelo servidor com base na próxima alocação, respeitando o gap de 5 minutos)
- Padrão: maior duração disponível pré-selecionada
- O backend já suportava o parâmetro `durationMinutes` — agora o agente o envia corretamente

---

## 3. Avisos de Fim de Sessão (10, 5 e 1 minuto)

**Arquivos:**

- `apps/agent/screen_lock.py` — método `show_warning_popup()`
- `apps/agent/agent.py` — lógica de threshold no heartbeat

**Problema:** O usuário não recebia nenhum aviso antes da sessão encerrar, podendo perder trabalho não salvo.

**Solução:**

- Popup flutuante (`CTkToplevel`) aparece no topo da tela quando restam:
  - **10 minutos** — ícone ⏰, cor amarela (warning)
  - **5 minutos** — ícone ⏰, cor amarela (warning)
  - **1 minuto** — ícone ⚠️, cor vermelha (danger)
- Cada aviso aparece apenas uma vez por sessão (tracking via `_warnings_shown`)
- Popup fecha automaticamente após 8 segundos
- Thresholds são resetados quando a alocação termina (pronto para a próxima sessão)
- O popup é não-bloqueante: aparece sobre o desktop sem impedir o trabalho

---

## 4. Correção do Status da Máquina Após Fim de Sessão

**Arquivos:**

- `apps/agent/agent.py` — heartbeat handler
- `apps/api/app/controllers/agent_controller.ts` — heartbeat endpoint

**Problema:** Quando uma alocação expirava, o status da máquina ficava travado em "ocupado" na tela de login e no painel web. Isso acontecia porque:

1. O `reportLogin` definia `machine.status = 'occupied'`
2. Ao fim da alocação, o agente exibia o overlay de bloqueio mas nunca chamava `reportLogout`
3. O servidor nunca corrigia o status automaticamente

**Solução (duas camadas de proteção):**

### Agente (client-side)

- Quando o heartbeat retorna `shouldBlock=true` e há um usuário logado (`logged_user_id`), o agente agora:
  1. Chama `api.report_logout()` automaticamente
  2. Limpa `logged_user_id` e `logged_user_name`
  3. Exibe o overlay de bloqueio

### API (server-side, safety net)

- No handler do heartbeat, após buscar `currentAllocation`:
  - Se não há alocação ativa **e** `machine.status === 'occupied'`, automaticamente:
    1. Define `machine.status = 'available'`
    2. Limpa `machine.loggedUser = null`
    3. Persiste no banco

Isso garante que mesmo se o agente falhar em reportar logout (crash, rede, etc.), o status é corrigido no próximo heartbeat.

---

## 5. Sincronização de Horário (Web + Agente)

**Arquivos:**

- `apps/api/app/controllers/utils_controller.ts` — endpoint `/api/time`
- `apps/api/start/routes.ts` — registro da rota
- `apps/web/src/services/timeSync.ts` — composable de sincronização
- `apps/web/src/main.ts` — inicialização do sync
- `apps/agent/time_sync.py` — fallback via `serverTime` do heartbeat
- `apps/agent/agent.py` — integração do fallback

### Endpoint Público `/api/time`

- Retorna `{ utc: string, unixMs: number }` com o horário UTC do servidor (Luxon `DateTime.now()`)
- Não requer autenticação — acessível por qualquer cliente

### Frontend (Web)

- Módulo `timeSync.ts` exporta:
  - `startTimeSync()` — inicia sync periódico (a cada 5 minutos)
  - `serverNowMs()` — retorna timestamp UTC ajustado pelo offset servidor-cliente
  - `serverNowISO()` — retorna ISO string UTC ajustada
  - `isSynced()` / `getOffsetMs()` — status do sync
- Calcula offset usando RTT (round-trip time): `offset = serverUnixMs - (before + rtt/2)`
- Inicializado automaticamente em `main.ts`

### Agente (Python)

- **Primário**: NTP via `ntplib` (servidores `pool.ntp.org`, `time.google.com`, `a.ntp.br`, etc.)
- **Fallback**: `sync_from_server(server_iso)` usa o `serverTime` retornado no heartbeat
  - Só atua se NTP não sincronizou (não sobrescreve offset mais preciso)
  - Corrige apenas se diferença > 1 segundo

### Garantia

Todos os horários trafegam em UTC:

- Frontend converte local→UTC antes de enviar (`new Date(...).toISOString()`)
- API armazena em UTC (Luxon + `TZ=UTC` no `.env`)
- Agente usa `utc_iso()` corrigido por NTP/server

---

## Resumo das Alterações por Arquivo

| Arquivo                                           | Tipo       | Descrição                                             |
| ------------------------------------------------- | ---------- | ----------------------------------------------------- |
| `apps/web/src/views/admin/AdminDashboardView.vue` | Modificado | Auto-refresh 10s (máquinas), 30s (alocações)          |
| `apps/agent/screen_lock.py`                       | Modificado | Seletor de duração, popup de aviso de sessão          |
| `apps/agent/agent.py`                             | Modificado | Avisos de fim de sessão, auto-logout, sync serverTime |
| `apps/agent/time_sync.py`                         | Modificado | `sync_from_server()` fallback                         |
| `apps/api/app/controllers/agent_controller.ts`    | Modificado | Auto-correção status occupied→available               |
| `apps/api/app/controllers/utils_controller.ts`    | Modificado | Endpoint `/api/time`                                  |
| `apps/api/start/routes.ts`                        | Modificado | Rota `/api/time`                                      |
| `apps/web/src/services/timeSync.ts`               | Novo       | Módulo de sincronização de relógio                    |
| `apps/web/src/main.ts`                            | Modificado | Inicializa timeSync                                   |
