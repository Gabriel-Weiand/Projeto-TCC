# Módulo Agente (Lab Agent Daemon)

Documentação de referência do daemon `agentd.py` — comunicação com a API AdonisJS, provisionamento POSIX/SSH, telemetria de hardware e auditoria de segurança.

**Código-fonte:** `apps/agent/agentd.py`  
**Rotas consumidas:** `apps/api/start/routes.ts` → prefixo `/api/v1/agent`  
**Lógica de resposta (heartbeat):** `apps/api/app/services/heartbeat_service.ts`  
**Multi-disco / home na reserva:** `apps/api/app/services/disk_partitions.ts`, `allocation_home_mount.ts`

---

## Sumário

1. [Papel e arquitetura](#1-papel-e-arquitetura)
2. [Configuração (.env)](#2-configuração-env)
3. [Autenticação](#3-autenticação)
4. [Mapa de rotas da API](#4-mapa-de-rotas-da-api)
5. [GET /api/config — bootstrap de telemetria](#5-get-apiconfig--bootstrap-de-telemetria)
6. [PUT /api/v1/agent/sync-specs](#6-put-apiv1agentsync-specs)
7. [POST /api/v1/agent/heartbeat](#7-post-apiv1agentheartbeat)
8. [POST /api/v1/agent/telemetry](#8-post-apiv1agenttelemetry)
9. [Multi-disco, home e conflitos](#9-multi-disco-home-e-conflitos)
10. [Descomissionamento (exclusão admin)](#10-descomissionamento-exclusão-admin)
11. [Ciclo de vida de alocação](#11-ciclo-de-vida-de-alocação)
12. [Provisionamento no Linux](#12-provisionamento-no-linux)
13. [Telemetria — campos e justificativas](#13-telemetria--campos-e-justificativas)
14. [Threads e loop principal](#14-threads-e-loop-principal)
15. [GPU — backends e detecção](#15-gpu--backends-e-detecção)
16. [Auditoria SSH](#16-auditoria-ssh)
17. [Resiliência e falhas](#17-resiliência-e-falhas)
18. [Hardening no boot](#18-hardening-no-boot)
19. [Catálogo de funções de captura](#19-catálogo-de-funções-de-captura)

---

## 1. Papel e arquitetura

O agente opera num modelo **State Enforcement (Pull Model)**:

- Não aceita conexões externas.
- A cada intervalo fixo (~30 s) consulta a API e **reconcilia** o estado desejado com o Linux.
- Não há fila local de ordens nem ACL persistida em disco — apenas cache em memória (`LAST_ACCESS_STATE`, `AGENT_CONFIG`, `SSH_AUDIT_BUFFER`).

### Responsabilidades

| Área | O que faz |
|------|-----------|
| **Provisionamento** | `useradd`, `usermod`, chaves `authorized_keys`, `userdel`, limpeza multi-partição |
| **Controle de acesso** | Bash (`/bin/bash`) vs SFTP (`sftp-server`) conforme fase da alocação |
| **Processos** | `pkill -u` na transição `full_shell` → `sftp_only` e na remoção de conta |
| **Telemetria** | CPU, GPU, RAM, swap, discos, rede, temperaturas, usuários ativos, processos pesados |
| **Auditoria** | Parse de `/var/log/auth.log` → tentativas SSH para a API |
| **Inventário** | `sync-specs` atualiza CPU, GPU, RAM, discos, IP, fingerprint do host |

### Variante suportada

**Agente servidor Linux** — headless, usuários POSIX prefixo `lab.`, SSH/SFTP.

> **Nota:** O controle de acesso é exclusivamente via chaves SSH e fase da alocação (`full_shell` → grace → `sftp_only` → remoção), conforme `LAB_ALLOCATION_*` na API.

---

## 2. Configuração (.env)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `MACHINE_TOKEN` | **Sim** | Bearer token da máquina (128 hex). Gerado no seed ou admin → regenerar token. |
| `SERVER_URL` | Não | Base da API (padrão `http://localhost:3333`). Sem barra final. |
| `MACHINE_NAME` | Não | Nome exibido no log; padrão = hostname. |

O agente monta `API_BASE = {SERVER_URL}/api/v1/agent`.

**Intervalos fixos no código (não configuráveis via .env):**

| Constante | Valor | Motivo |
|-----------|-------|--------|
| `HEARTBEAT_INTERVAL` | 30 s | Controle de acesso e drift; independente do preset de telemetria |
| Buffer SSH máximo | 500 entradas | Evita OOM se API ficar offline por semanas |
| Despacho SSH | ≥20 entradas **ou** 12:00 UTC | Reduz writes no banco sem perder eventos críticos |
| Lote SSH por heartbeat | máx. 50 (validado na API) | Proteção contra payload gigante |

Telemetria (`intervalSeconds`, `batchSize`, `telemetrySet`) vem da API via heartbeat ou `GET /api/config` no boot.

---

## 3. Autenticação

Todas as rotas `/api/v1/agent/*` exigem:

```http
Authorization: Bearer <MACHINE_TOKEN>
Content-Type: application/json
Accept: application/json
```

Middleware: `machine_auth_middleware.ts` → `machineCache.getByToken(token)`.

| Resposta | Código API | Comportamento do agente |
|----------|------------|-------------------------|
| Token ausente/inválido | 401 `INVALID_TOKEN` | **Não altera o SO** — evita wipe acidental se token rotacionado sem atualizar `.env` |
| Token válido | 200 | Aplica `provisioning` / `decommission` |
| Timeout / rede | exceção | Log `[C2] Erro no Heartbeat`; SO permanece no último estado aplicado |

---

## 4. Mapa de rotas da API

| Método | Rota | Quando roda | Controller |
|--------|------|-------------|------------|
| GET | `/api/config` | 1× no boot (opcional) | Público — presets de telemetria |
| PUT | `/api/v1/agent/sync-specs` | 1× no boot | `AgentController.syncSpecs` |
| POST | `/api/v1/agent/heartbeat` | A cada 30 s | `AgentController.heartbeat` → `HeartbeatService` |
| POST | `/api/v1/agent/telemetry` | A cada `intervalSeconds` | `AgentController.telemetry` |

Relacionamento com o front/admin:

- Presets e políticas de lab: `LabSettingsController`, `.env` (`LAB_ALLOCATION_*`)
- Discos e `onlyMainDisk`: `MachinesController` (PUT máquina)
- `homeMountpoint` na reserva: `AllocationsController` → validado antes de gravar
- Gatilho de processos on-demand: admin → `POST /machines/:id/request-process-report` → campo `onDemandProcessConfig` no próximo heartbeat

---

## 5. GET /api/config — bootstrap de telemetria

**Função:** `bootstrap_telemetry_from_lab_config()` — executada antes do primeiro heartbeat.

**Por quê:** Se a API estiver online no boot, o agente já inicia com o preset default do lab (ex.: `eco`) em vez do fallback hardcoded local.

**Resposta usada:**

```json
{
  "telemetry": {
    "defaultOfflinePreset": "eco",
    "presets": {
      "eco": { "intervalSeconds": 60, "batchSize": 15, "telemetrySet": { ... } },
      "fast": { ... }
    }
  }
}
```

Se falhar (API offline, timeout 5 s), permanece `_ECO_TELEMETRY_OFFLINE` até o primeiro heartbeat 200.

---

## 6. PUT /api/v1/agent/sync-specs

**Quando:** Uma vez após boot (thread principal, antes das workers).

**Objetivo:** Registrar hardware **estável** no banco. Telemetria dinâmica (uso %) não passa por aqui.

### Request (corpo JSON)

| Campo | Tipo | Origem no agente | Justificativa |
|-------|------|------------------|---------------|
| `cpuModel` | string | `/proc/cpuinfo` → `model name` | Identificação no painel e relatórios |
| `gpuModel` | string? | NVML (NVIDIA) ou `lspci -mm` | Exibição; fallback quando driver não expõe nome |
| `totalRamGb` | int | `psutil.virtual_memory().total` → **GB×10** | Formato wire único (155 = 15,5 GB) |
| `totalVramGb` | int? | `_GPU.vram()` total → GB×10 | Omitido se iGPU / VRAM dedicada = 0 |
| `ipAddress` | string? | UDP connect trick / interface local | IP interno da estação |
| `hostFingerprint` | string? | `ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub` | Front valida fingerprint na conexão SSH |
| `disks` | array | `_disk_partitions()` | Inventário de partições; ver abaixo |

#### Item de `disks[]`

| Campo | Descrição |
|-------|-----------|
| `device` | `/dev/nvme0n1p1`, etc. |
| `mountpoint` | `/`, `/data/lab`, … |
| `fstype` | `ext4`, `xfs`, `btrfs`, … (filtro: filesystems “reais”) |
| `totalGb` | Capacidade (1 decimal) |
| `freeGb` | Espaço livre (1 decimal) |
| `role` | `system` \| `user` — classificação local espelhada em `#services/disk_partitions.ts` |

**API:** `mergeDiskPartitionsFromAgent` preserva flags admin (`mainDisk`, `role`) ao atualizar `totalGb`/`freeGb` do agente.

### Response 200

```json
{
  "synced": true,
  "machine": { "id", "name", "cpuModel", "gpuModel", "totalVramGb", "totalRamGb" }
}
```

---

## 7. POST /api/v1/agent/heartbeat

**Intervalo:** 30 s (`HEARTBEAT_INTERVAL`) — **não** segue `intervalSeconds` da telemetria.

**Papel:** Canal de **comando e controle**. A telemetria pesada vai em `/telemetry`.

### 7.1 Request — campos enviados pelo agente

```json
{
  "connectedUsers": ["lab.gabriel_santos"],
  "provisionedOsUsers": ["lab.gabriel_santos", "lab.aluno_dois"],
  "sshAttempts": [ { ... } ]
}
```

| Campo | Tipo | Captura | Justificativa |
|-------|------|---------|---------------|
| `connectedUsers` | `string[]` | `psutil.users()` filtrado `lab.*` | API grava `machine.current_sessions`; dashboard “quem está online”; **ignora root e contas locais** |
| `provisionedOsUsers` | `string[]` | `pwd.getpwall()` filtrado `lab.*` | **Drift detection:** compara SO real vs `machine_users` + alocações; API remove linhas órfãs do inventário |
| `sshAttempts` | array (0–50) | Buffer de `parse_ssh_line(auth.log)` | Auditoria de segurança; flood detection; **opcional** — só anexado se buffer ≥20 **ou** minuto 0 de 12:00 UTC |

#### Objeto `sshAttempts[]`

| Campo | Valores | Origem no log |
|-------|---------|---------------|
| `sourceIp` | IPv4/IPv6 | Regex `from ([\d\.]+)` |
| `targetUsername` | string | Usuário alvo da tentativa |
| `status` | `success` \| `failed` \| `invalid_user` | `Accepted` / `Failed` / `Invalid user` |
| `authMethod` | `publickey`, `password`, null | Grupo capturado em `Accepted (\w+)` |
| `clientFingerprint` | `SHA256:...` ou null | Só em login por chave bem-sucedida |

**Por que não enviar SSH a cada heartbeat?** Reduz carga no banco; eventos acumulam na thread `ssh_audit_worker` (tail de `/var/log/auth.log`).

**Por que 12:00 UTC?** Garante flush diário mesmo com pouca atividade.

### 7.2 Response — campos recebidos pela API

```json
{
  "status": "acknowledged",
  "decommission": false,
  "agentConfig": {
    "telemetry": {
      "intervalSeconds": 5,
      "batchSize": 10,
      "telemetryPreset": "fast",
      "telemetryMode": "auto",
      "telemetrySet": { "cpu": true, "gpu": true, ... },
      "onDemandProcessConfig": { "requestTimestamp": "...", "thresholds": { ... } }
    }
  },
  "provisioning": [
    {
      "systemUsername": "lab.aluno_t5",
      "sshPublicKey": "ssh-ed25519 AAAA...",
      "accessState": "sftp_only",
      "revokeSshKey": false,
      "homeDirectory": "/data/lab/lab.aluno_t5"
    }
  ],
  "accessControl": { "shouldBlock": false },
  "currentAllocation": {
    "id": 42,
    "userId": 7,
    "userName": "Aluno",
    "endTime": "2026-06-10T18:00:00.000Z",
    "phase": "active",
    "graceEndsAt": "...",
    "sftpEndsAt": "..."
  }
}
```

| Campo | Descrição |
|-------|-----------|
| `status` | Sempre `acknowledged` em sucesso |
| `decommission` | `true` se admin iniciou exclusão da máquina (`customAgentConfig.pendingRemoval`) — agente chama `_purge_all_lab_users()` |
| `agentConfig.telemetry` | Preset efetivo: **eco** ocioso, **fast** em alocação ativa/grace, **custom** se máquina usa preset custom |
| `provisioning[]` | Lista **completa** desejada agora (declarativa, não delta) |
| `accessControl.shouldBlock` | Reservado; sempre `false` (bloqueio é por shell/chave) |
| `currentAllocation` | Preenchido em fase `active` ou `grace` — UI countdown / estender |

#### Item de `provisioning[]`

| Campo | Valores | Efeito no agente |
|-------|---------|------------------|
| `systemUsername` | `lab.*` | Nome POSIX (`useradd` / `usermod`) |
| `sshPublicKey` | `ssh-ed25519 ...` ou vazio | Escrita em `~/.ssh/authorized_keys`; **só ed25519** é aceita |
| `accessState` | `full_shell` \| `sftp_only` | `/bin/bash` vs `SFTP_SHELL` |
| `revokeSshKey` | boolean | Se `true`, trunca `authorized_keys` (fase `no_key`) |
| `homeDirectory` | path absoluto, opcional | `useradd -d` na criação; `usermod -d` se `allowHomeMigration` |
| `allowHomeMigration` | boolean, opcional | `true` quando reservas antigas só em `no_key` — ver [§9](#correção-implementada-migração-de-home-no_key) |

**API — quem entra em `provisioning`:**

1. Usuários com `machine_users.access_type` fixo (`shell` \| `sftp` \| `revoked`) — ignora ciclo de alocação.
2. Usuários `auto` com alocação `approved`/`finished` em fase ≠ `none`/`teardown` — via `#services/allocation_access`.

**Side effects na API (por heartbeat 200):**

- `machine.lastSeenAt = now`
- `machine.currentSessions = connectedUsers`
- Upsert `machine_users` + `lastActiveAt` se `full_shell`
- Grava `sshAttempts` → `ssh_connection_attempts`
- Remove `machine_users` se SO não lista mais o usuário e API não precisa dele

### 7.3 Processamento no agente (`apply_provisioning`)

```
FASE 1 — Drift
  Para cada lab.* no passwd NÃO listado em provisioning → _purge_lab_user()

FASE 2 — Scan órfãos
  Diretórios lab.* em partições user sem passwd → rmtree

FASE 3 — Provisionar cada item
  useradd (se KeyError) com -d homeDirectory
  ~/.ssh/authorized_keys, chmod/chown
  pkill se full_shell → sftp_only
  usermod -s bash | sftp
```

**Crítico:** Só executa se HTTP **200**. Lista vazia `provisioning: []` **ainda** remove contas órfãs (exceto durante outage da API — exceção não aplicada).

---

## 8. POST /api/v1/agent/telemetry

**Intervalo:** `AGENT_CONFIG.telemetry.intervalSeconds` (5–300+ conforme preset).

**Batching:** Acumula `batchSize` amostras em buffer; POST único com `{ "data": [ ... ] }`.

### Roteamento na API

| Situação | Destino |
|----------|---------|
| Alocação `approved` ativa no instante da amostra | `telemetryBuffer` + persistência futura ligada à alocação |
| Máquina ociosa | `telemetryBuffer` realtime + `idleTelemetryBuffer` (histórico ocioso) |

### Amostra (`data[]`) — campos

| Campo | Wire | Real | Condicionado por `telemetrySet` | Justificativa |
|-------|------|------|----------------------------------|---------------|
| `timestamp` | ISO UTC | — | sempre | Correlação temporal / gráficos |
| `cpuUsage` | int ×10 | % | `cpu` | Carga agregada do host |
| `cpuTemp` | int ×10 | °C | `temperatures` | Thermal throttling / alertas |
| `cpuFreqMhz` | int | MHz | `cpu` | Contexto de carga (turbo) |
| `moboTemperature` | int ×10 | °C | `temperatures` | Sensores placa-mãe |
| `gpuUsage` | int ×10 | % | `gpu` | Utilização GPU |
| `gpuTemp` | int ×10 | °C | `gpu` | Termal GPU |
| `gpuPowerWatts` | int | W | `gpu` | Consumo (NVML/AMD sysfs) |
| `ramTotalGb` | int ×10 | GB | `ramAndSwap` | Capacidade |
| `ramUsedGb` | int ×10 | GB | `ramAndSwap` | Pressão de memória |
| `swapTotalGb` | int ×10 | GB | `ramAndSwap` | Swap configurado |
| `swapUsedGb` | int ×10 | GB | `ramAndSwap` | Swap em uso |
| `vramTotalGb` | int ×10 | GB | `gpu` | VRAM dedicada |
| `vramUsedGb` | int ×10 | GB | `gpu` | VRAM em uso |
| `diskReadMbps` | int | Mbps | `disk` | Throughput agregado leitura |
| `diskWriteMbps` | int | Mbps | `disk` | Throughput agregado escrita |
| `disksInfo` | array | — | `disk` | Por-partição: `device`, `mountpoint`, `totalGb`, `freeGb`, I/O |
| `downloadMbps` | int | Mbps | `networkIO` | Tráfego recebido |
| `uploadMbps` | int | Mbps | `networkIO` | Tráfego enviado |
| `activeUsers` | array | — | `activeUsers` | Sessões `lab.*` (detalhe TTY/SSH) |
| `processes` | array | — | `processCapture` ou on-demand (5 batches) | Top processos (todos os usuários) |

**Valores omitidos / null:** Métrica desligada no preset → campo ausente ou `null` (API normaliza para UI `—`).

#### `processes[]` (captura contínua ou on-demand)

Quando `telemetrySet.processCapture` está ativo, o agente envia o Top X a cada amostra, ordenado pela métrica configurada em `processCaptureConfig.compareMetric` e filtrado por `processCaptureConfig.userScope`.

| `userScope` | Comportamento |
|-------------|---------------|
| `session` | Apenas processos cujo `username` é um `lab.*` com sessão TTY/SSH ativa (`psutil.users()`) |
| `all` | Todos os processos do host (qualquer usuário POSIX) |

Gatilho on-demand (`POST /machines/:id/request-processes`) dispara 5 batches extras com `compareMetric`, `topX` e `userScope`.

**Compatibilidade legado:** pedidos pendentes gravados antes do refactor usam `thresholds: { cpuPercent, ramMb, vramMb, diskReadKbps, diskWriteKbps, topX }` (limiares mínimos OR + ordenação fixa VRAM > CPU > RAM > I/O). O agente mapeia para o modelo Top-X: `topX` é lido de `thresholds.topX`; `compareMetric` infere-se pelo primeiro limiar não-default nessa ordem de prioridade (padrão `vramMb`); `userScope` passa a `all` (equivalente ao scan de host antigo, exceto root/systemd/messagebus). Não reproduz o filtro OR exato — apenas preserva a intenção de ordenação e o Top X solicitado.

| Campo | Wire | Descrição |
|-------|------|-----------|
| `cpuPercent` | int ×10 | Uso de CPU do processo |
| `ramMb` | int | RAM RSS em MB |
| `vramMb` | int | VRAM em MB (NVIDIA via nvitop) |
| `gpuUse` | int ×10 | Uso SM da GPU (NVIDIA via nvitop; modelos antigos podem retornar 0) |
| `diskReadKbps` | int | Leitura de disco |
| `diskWriteKbps` | int | Escrita de disco |

Métricas de comparação disponíveis: `cpuPercent`, `ramMb`, `vramMb`, `gpuUse`, `diskReadKbps`, `diskWriteKbps`.

---

## 9. Multi-disco, home e conflitos

### Modelo de dados (API)

- `machines.disks[]`: cada partição com `role` (`system` \| `user`) e `mainDisk` (exatamente um `user` principal).
- `machines.only_main_disk`: se `true`, reserva só aceita o mount principal.
- `allocations.home_mountpoint`: volume escolhido na reserva (nullable → default = principal).

### Resolução na API

```
homeDirectory = {homeMountpoint}/{systemUsername}
```

Ex.: mount `/data/lab` + user `lab.gabriel_santos` → `/data/lab/lab.gabriel_santos`.

Funções: `normalizeAllocationHomeMount`, `listAllocatableDiskMountpoints`, `resolveHomeDirectory`.

### O que o agente faz

| Momento | Comportamento |
|---------|---------------|
| **Criação** (`useradd`) | Se `homeDirectory` presente → `-d {homeDirectory}`; senão home padrão do SO (`/home/lab.*`) |
| **Conta já existe** | **Não migra home** — `usermod -d` não é chamado. Nova reserva em outro disco com mesma conta reutiliza home antigo até `userdel` |
| **Remoção** (`_purge_lab_user`) | `userdel -r -f` + varredura em **todas** as partições `role=user` + `/home/{uname}` + paths do passwd |

### Conflitos tratados

| Cenário | Tratamento |
|---------|------------|
| Reserva pede `/data` mas `onlyMainDisk=true` | API rejeita na criação (`422`) |
| Mount inválido / sistema | API rejeita — agente nunca recebe |
| Duas reservas sequenciais, discos diferentes | Home na 1ª criação; **migração em `no_key`** da antiga via `allowHomeMigration` ([§9](#correção-implementada-migração-de-home-no_key)) |
| Dados órfãos após `userdel` falho parcial | `_scan_orphan_lab_dirs()` remove dirs `lab.*` sem passwd em partições user |
| Admin remove usuário provisionado | DELETE `machine_users` → próximo heartbeat sem item → drift + purge multi-partição |
| Mesmo usuário, duas alocações | API escolhe **fase dominante** (`resolveDominantAccessForUser`) — prevalece `active`/`grace` sobre `no_key` antiga |
| sync-specs atualiza discos | `mergeDiskPartitionsFromAgent` mantém `mainDisk`/`role` admin |

### Edge-case: homes em discos diferentes, alocações sobrepostas

Cenário típico:

- Alocação **A** em `/data/lab` → home `/data/lab/lab.aluno` — fase `no_key` ou perto de `teardown`
- Alocação **B** no **mesmo PC**, disco `/scratch` → home desejado `/scratch/lab.aluno` — fase `active`

**A exclusão/teardown de A interfere na alocação B ativa?**

**Não, na conta nem no acesso.** Motivos:

1. **Provisionamento é por usuário POSIX** (`lab.aluno`), não por alocação nem por disco. O agente recebe **no máximo uma** entrada em `provisioning[]` por `systemUsername`.
2. **`resolveDominantAccessForUser`** (`allocation_access.ts`) compara todas as alocações `approved`/`finished` do mesmo `userId` na máquina e escolhe a fase de **maior rank** (`PHASE_RANK`: `active`=50 > `grace`=40 > … > `no_key`=10 > `teardown`=0).
3. Enquanto **B** estiver `active`/`grace`/`prepare`/`post_sftp`, a fase dominante **não** é `teardown` de A → o usuário **permanece** em `provisioning` → o agente **não** executa `_purge_lab_user` (drift só remove quem **não** está na lista).
4. **`homeDirectory` + `allowHomeMigration` no heartbeat** — vêm da alocação dominante. Na **1ª criação**, `useradd -d`. Se a conta já existe e `allowHomeMigration: true` (só quando reservas antigas estão em `no_key`/`none`/`teardown`), o agente faz `usermod -d` para o disco da reserva nova **sem apagar** a home antiga.

**O que acontece com os dados em cada disco?**

| Momento | Disco A (`/data/lab/...`) | Disco B (`/scratch/...`) | Conta `lab.aluno` |
|---------|---------------------------|--------------------------|-------------------|
| A em `no_key`, B `active` | Pasta antiga **permanece** (não há purge por alocação) | Dados novos se o usuário gravar manualmente em `/scratch` | Mantida, bash ativo (dominante B) |
| A entra em `teardown` sozinha | Pasta **ainda não apagada** | Idem | **Mantida** (B ainda exige provisioning) |
| B também passa `teardown` + `deleteUserDays` | — | — | Sai de `provisioning` → `_purge_lab_user` |
| Purge final | `_collect_user_remnant_paths` varre **todas** as partições `user` + `/home` + passwd | Idem — **ambas** as pastas `lab.aluno` são candidatas à remoção | `userdel -r -f` + `rmtree` nos paths |

**Conclusão:** teardown de A **não** derruba sessão, chave nem conta enquanto B (ou outra alocação do mesmo usuário) ainda exigir acesso. A limpeza física é **por conta**, não por alocação/disco — só ocorre quando **nenhuma** alocação daquele usuário na máquina precisa mais de provisioning. Resíduos no disco da alocação antiga podem ficar no filesystem até esse purge final (comportamento intencional para não apagar dados enquanto o mesmo `lab.*` ainda está ativo).

**Diagrama de decisão (API → agente):**

```text
Alocações do userId na máquina
        │
        ▼
resolveDominantAccessForUser  ──► fase dominante + allocation B
        │
        ▼
phaseToProvisioning + resolveHomeDirectory(B.homeMountpoint)
        │
        ▼
provisioning: [{ systemUsername, accessState, homeDirectory?, ... }]
        │
        ▼
Agente: conta em expected_users?  SIM → não purge
                                   NÃO → _purge_lab_user (multi-partição)
```

### Alocações próximas: disco efetivo no login (comportamento atual)

Premissa: alocação **A** já criou `lab.aluno` com home em **disco A** (`useradd -d` no `prepare` de A). Alocação **B** reserva **disco B** no mesmo PC.

| Estado da alocação antiga (A) | Nova reserva (B) | Shell dominante (típico) | Disco/home efetivo no SSH/SFTP **hoje** |
|------------------------------|------------------|--------------------------|----------------------------------------|
| `post_sftp` | B em `prepare` | SFTP (`prepare` > `post_sftp`) | **Disco A** — home do `passwd` |
| `post_sftp` | B `active` | Bash | **Disco A** |
| `no_key` | B em `prepare` / `active` / `grace` | conforme B | **Disco B** após heartbeat com `allowHomeMigration` |
| `teardown` (conta ainda não purgada)* | B em `prepare`/`active` | conforme B | **Disco A** até purge, depois **disco B** no próximo `useradd` |
| Conta purgada (`userdel`) | B em `prepare` (1ª criação) | SFTP → bash | **Disco B** — novo `useradd -d` |

\*Enquanto B mantém o usuário em `provisioning`, A em `teardown` sozinha **não** dispara purge; a linha relevante é “conta purgada” quando **nenhuma** alocação exige mais a conta.

**Janela problemática (aceita):** A ainda em `post_sftp` e B começando — SFTP/bash da reserva nova, mas home permanece no **disco A** até A passar a `no_key` (sem chave útil na home antiga).

### Correção implementada: migração de home em `no_key`

**Quando:** alocação dominante B envia `homeDirectory` em disco B e **nenhuma** outra alocação do mesmo usuário na máquina está em `post_sftp`, `active`, `grace` ou `prepare` — tipicamente, a reserva antiga A só resta em **`no_key`**.

**API** (`allowHomeMigrationForUser` em `allocation_access.ts` → `heartbeat_service.ts`):

```json
{
  "systemUsername": "lab.aluno",
  "homeDirectory": "/scratch/lab.aluno",
  "allowHomeMigration": true,
  "accessState": "full_shell",
  "sshPublicKey": "ssh-ed25519 ..."
}
```

**Agente** (`_maybe_migrate_user_home` em `agentd.py`), se `pw_dir` ≠ `homeDirectory`:

1. `pkill -u` (sessões residuais)
2. `mkdir` + `chown` da nova home
3. `usermod -d` (sem `-m` — discos distintos)
4. Fluxo normal grava `authorized_keys` na **nova** home
5. **Não apaga** arquivos no disco A

**Expiração da alocação A:** quando A entra em `teardown` (`endTime + 7d`), ela **deixa de exigir** provisioning, mas a conta **permanece** enquanto B (ou outra reserva) ainda precisar de acesso. Só quando **nenhuma** alocação do usuário na máquina exigir provisioning é que o drift faz `userdel` + purge multi-partição. Se B ainda estiver ativa, o usuário **continua** no disco B; se B também expirou, purge remove ambas as árvores de dados.

**Limitação remanescente:** overlap com A em `post_sftp` — home fica no disco A até A ir para `no_key`.
### Diagrama reserva → home

```text
[Front: ReservationFormFields]
        │ homeMountpoint (select de listAllocatableDiskMountpoints)
        ▼
[API: allocations_controller.store]
        │ normalizeAllocationHomeMount(machine.disks, onlyMainDisk, ...)
        ▼
[DB: allocations.home_mountpoint]
        ▼
[HeartbeatService: resolveHomeDirectory → provisioning[].homeDirectory]
        ▼
[Agent: useradd -d homeDirectory]
```

---

## 10. Descomissionamento (exclusão admin)

Fluxo em **duas fases** (`DELETE /api/v1/machines/:id`):

### Fase 1 — `202 Accepted`

1. Cancela alocações `pending`/`approved` (notifica usuários).
2. Apaga todos `machine_users`.
3. Seta `customAgentConfig.pendingRemoval = true`, `status = offline`.
4. Front aguarda ~35 s e repete DELETE.

### Heartbeat com `pendingRemoval`

API retorna:

```json
{ "decommission": true, "provisioning": [], ... }
```

Agente:

```python
_purge_all_lab_users()  # userdel + resquícios em todas partições user
```

### Fase 2 — `204 No Content`

Remove registro `machines`, limpa `telemetryBuffer` / `idleTelemetryBuffer`.

**Por que duas fases?** Token ainda válido entre fases → agente recebe ordem de limpeza **antes** do registro sumir (401 impediria drift).

---

## 11. Ciclo de vida de alocação

Variáveis (`.env` / `lab_config`):

| Variável | Padrão | Papel |
|----------|--------|--------|
| `LAB_ALLOCATION_PREPARE_MINUTES` | 5 | T-N: SFTP + chave antes de `startTime` |
| `LAB_ALLOCATION_GRACE_MINUTES` | 10 | Bash extra após `endTime` |
| `LAB_ALLOCATION_POST_SFTP_MINUTES` | 1440 | SFTP com chave pós-grace |
| `LAB_ALLOCATION_DELETE_USER_DAYS` | 7 | Após isso → fase `teardown` → fora do `provisioning` |

### Fases (`approved`, término natural)

```text
prepare → active → grace → post_sftp → no_key → teardown
  SFTP     BASH     BASH     SFTP+key    SFTP no key   (sem provisioning)
```

**`finished` (POST finish):** pula grace; `sftpEndsAt = endTime`; depois `no_key` → teardown.

### Mapa fase → provisioning

| Fase | `accessState` | Chave | Agente |
|------|---------------|-------|--------|
| `prepare` | `sftp_only` | sim | useradd + SFTP + keys |
| `active` | `full_shell` | sim | bash |
| `grace` | `full_shell` | sim | bash (telemetria “quente”) |
| `post_sftp` | `sftp_only` | sim | pkill + SFTP |
| `no_key` | `sftp_only` | revogada | esvazia authorized_keys |
| `teardown` | — | — | **não** listado → drift remove |

---

## 12. Provisionamento no Linux

### Conta

- Prefixo `lab.` + `users.system_username`
- Grupo `lab` (`groupadd -f lab` no boot)
- UMASK 077 via `login.defs` + `useradd -K UMASK=0077`
- Permissões: home `700`, `.ssh` `700`, `authorized_keys` `600`
- **Sem senha** — apenas chave pública
- **Sem sudo** — controle é shell vs SFTP, não privilégio root

### Transições críticas

```
full_shell → sftp_only : pkill -u  THEN  usermod -s SFTP_SHELL
revokeSshKey=true      : truncate authorized_keys
drift / decommission   : _purge_lab_user → multi-partição
```

### SFTP pós-reserva

Objetivo: copiar artefatos da home sem terminal. Shell = `SFTP_SHELL` detectado no boot (`which sftp-server` / glob openssh).

---

## 13. Telemetria — campos e justificativas

### Convenção numérica (wire)

| Tipo | Formato | Exemplo |
|------|---------|---------|
| Percentuais | ×10 int | 45,0% → `450` |
| Temperaturas | ×10 int | 65,0°C → `650` |
| Gigabytes | ×10 int | 16,5 GB → `165` |
| Potência GPU | int W | 150 W → `150` |
| I/O rede/disco | int Mbps | 300 Mbps → `300` |

### Presets (API → agente)

| Modo | Preset típico | Quando |
|------|---------------|--------|
| Ociosa | `eco` | Sem alocação em active/grace |
| Em uso | `fast` | Alocação active/grace |
| Admin custom | `custom` | `machines.custom_agent_config` |

`buildAgentTelemetryConfig` também aplica `clampCustomTelemetryInterval` (mín. 2 s).

Implementação detalhada de cada coletor: [§19 Catálogo de funções de captura](#19-catálogo-de-funções-de-captura).

---

## 14. Threads e loop principal

```
main()
  ├─ hardening (group lab, UMASK)
  ├─ bootstrap_telemetry_from_lab_config()
  ├─ sync_specs()
  ├─ Thread: heartbeat_worker()     → 30 s
  ├─ Thread: telemetry_worker()     → intervalSeconds
  └─ Thread: ssh_audit_worker()     → tail auth.log
```

| Thread | Bloqueio | Compartilha |
|--------|----------|-------------|
| Heartbeat | `CONFIG_LOCK` ao ler/escrever config e buffer SSH | `AGENT_CONFIG`, `SSH_AUDIT_BUFFER` |
| Telemetria | `CONFIG_LOCK` ao ler interval/batch | `AGENT_CONFIG`, `PROCESS_BATCHES_REMAINING` |
| SSH audit | `CONFIG_LOCK` ao append buffer | `SSH_AUDIT_BUFFER` |

---

## 15. GPU — backends e detecção

Ordem em `_detect_gpu_backend()`:

1. **NVIDIA** (`nvitop` + `pynvml`) — uso GPU/VRAM/processos via **nvitop**; nome da placa em sync-specs via pynvml. **Compatível com placas NVIDIA suportadas pelo driver/NVML moderno; modelos muito antigos podem não expor métricas via nvitop** (uso GPU e `gpuUse` por processo ficam ausentes/zerados).
2. **AMD** (`amdgpu` sysfs) — `gpu_busy_percent`, VRAM, power hwmon
3. **Intel** (i915/xe sysfs) — freq ratio como proxy de uso
4. **_NullBackend** — zeros silenciosos

Multi-GPU: usa índice 0; comentário no código para iterar dispositivos se necessário.

---

## 16. Auditoria SSH

- Arquivo: `/var/log/auth.log` (hardcoded — typical Debian/Ubuntu)
- Rotação: detecta mudança de inode → reopen
- Boot: `seek END` — não reenvia histórico antigo
- Parser: `parse_ssh_line` — ignora linhas sem `sshd`

Eventos gravados em `ssh_connection_attempts` (API) + notificação flood (`checkSshFailureFlood`).

---

## 17. Resiliência e falhas

| Evento | SO | API | Agente (processo) |
|--------|----|----|-------------------|
| API offline | Congela último estado | Fases avançam por tempo | Exceção logada; retry 30 s |
| Reboot máquina | Persiste passwd/keys | `lastSeenAt` stale → offline efetivo | Restart → sync-specs + heartbeat |
| Token inválido | Congela | — | 401 → **não** purge (segurança) |
| pendingRemoval | Purge no próximo 200 | Aguarda 2º DELETE | `_purge_all_lab_users` |

**Dessincronia esperada:** UI pode mostrar fase `post_sftp` enquanto SO ainda tem bash até próximo heartbeat 200.

---

## 18. Hardening no boot

Idempotente em `main()`:

1. `groupadd -f lab`
2. Substitui `UMASK` em `/etc/login.defs` por `077`

Falhas logadas como aviso — daemon continua.

---

## 19. Catálogo de funções de captura

Referência de **todas** as funções de coleta em `agentd.py`: origem dos dados (psutil, sysfs, NVML, subprocess, etc.), rota/consumidor e formato wire.

### 19.1 Telemetria periódica (`collect_telemetry`)

| Função / chamada | Biblioteca / origem | API psutil / SO | Campo(s) wire | `telemetrySet` | Justificativa |
|------------------|---------------------|-----------------|---------------|----------------|---------------|
| `psutil.cpu_percent(interval=None)` | psutil | CPU global instantânea | `cpuUsage` (×10) | `cpu` | Carga agregada do host; `interval=None` usa delta desde última chamada |
| `psutil.cpu_freq(percpu=False)` | psutil | Frequência atual MHz | `cpuFreqMhz` | `cpu` | Contexto turbo/throttle junto com uso |
| `_read_temperatures()` | psutil | `sensors_temperatures()` | `cpuTemp`, `moboTemperature` (×10) | `temperatures` | Ver §19.2 |
| `_ram_wire()` | psutil | `virtual_memory()` total/available | `ramTotalGb`, `ramUsedGb` (×10) | `ramAndSwap` | Pressão de RAM |
| `_swap_wire()` | psutil | `swap_memory()` total/used | `swapTotalGb`, `swapUsedGb` (×10) | `ramAndSwap` | Swap em uso |
| `_GPU.usage()` | backend GPU | nvitop (NVIDIA) / sysfs AMD/Intel | `gpuUsage` (×10) | `gpu` | Utilização GPU; NVIDIA exige nvitop |
| `_GPU.temp()` | backend GPU | NVML / `sensors_temperatures` amdgpu | `gpuTemp` (×10) | `gpu` | Termal GPU |
| `_GPU.power()` | backend GPU | NVML mW / AMD hwmon µW | `gpuPowerWatts` (int W) | `gpu` | Consumo elétrico |
| `_GPU.vram()` | backend GPU | NVML mem / AMD mem_info_vram_* | `vramTotalGb`, `vramUsedGb` (×10) | `gpu` | Memória dedicada; omitido se total=0 (iGPU) |
| `_net_delta()` | psutil | `net_io_counters()` + delta monotonic | `downloadMbps`, `uploadMbps` | `networkIO` | Ver §19.3 |
| `_disk_metrics(space, io)` | psutil | `disk_partitions`, `disk_usage`, `disk_io_counters` | `diskReadMbps`, `diskWriteMbps`, `disksInfo[]` | `disk` | Espaço e I/O juntos |
| `_active_users()` | psutil | `users()` filtrado `lab.*` | `activeUsers[]` | `activeUsers` | Sessões TTY/SSH provisionadas |
| `_get_top_processes()` | psutil + nvitop | `process_iter` + nvitop `Device.processes()` | `processes[]` | `processCapture` | Ver §19.5 |

**Aquecimento:** `telemetry_worker` chama `psutil.cpu_percent(interval=None)` uma vez antes do loop para estabilizar a primeira leitura de CPU.

### 19.2 `_read_temperatures()`

| Sensor psutil | Chave típica | Campo | Fallback |
|---------------|--------------|-------|----------|
| CPU package | `coretemp`, `k10temp`, `cpu_thermal` | `cpuTemp` — **max** dos entries | `acpitz[0]` |
| Placa-mãe | `acpitz` (se CPU já leu) | `moboTemp` | `null` |

GPU **não** entra aqui — temperatura GPU vem exclusivamente de `_GPU.temp()` para evitar duplicata.

### 19.3 `_net_delta()`

- **Entrada:** `psutil.net_io_counters()` → `bytes_recv`, `bytes_sent`
- **Estado:** cache global `_net_prev` com `{ t, recv, sent }` e `time.monotonic()`
- **Cálculo:** `(Δbytes × 8) / 1_000_000 / Δt` → Mbps arredondado
- **Primeira amostra:** retorna `0, 0` (sem delta anterior)

### 19.4 `_disk_metrics(collect_space, collect_io)`

| Passo | API | Detalhe |
|-------|-----|---------|
| I/O agregado | `disk_io_counters()` | `total_read`, `total_write` → Mbps host |
| I/O por disco | `disk_io_counters(perdisk=True)` | Chave = último segmento de `part.device` |
| Partições | `disk_partitions(all=False)` | Filtra `fstype` ∈ `real_fs` |
| Espaço | `disk_usage(mountpoint)` | Por mount: `usagePct` (×10), `freeGb` |
| Per-part I/O | delta vs `_disk_io_prev["disks"]` | `readMbps`, `writeMbps` em `disksInfo[]` |

**Cache:** `_disk_io_prev` guarda timestamp, totais e bytes por `dev_name` para deltas entre amostras.

**Sync-specs vs telemetria:** `_disk_partitions()` (boot) envia `device`, `fstype`, `totalGb`, `freeGb`, `role`; telemetria envia `usagePct` + I/O opcional sem repetir `device` em todos os presets.

### 19.5 `_get_top_processes(compare_metric, top_x)`

| Fonte | Campos lidos | Uso |
|-------|--------------|-----|
| `nvitop.Device.processes()` | PID → VRAM MB, SM % (`gpuUse` ×10) | Somente NVIDIA com nvitop |
| `psutil.process_iter([...])` | `pid`, `name`, `username`, `cpu_percent`, `memory_info`, `io_counters` | Host inteiro ou filtrado por sessão |
| `_active_users()` + `_session_lab_usernames()` | usernames `lab.*` conectados | Filtro quando `userScope=session` |
| Delta I/O | cache `_process_io_prev` por PID | `diskReadKbps`, `diskWriteKbps` |

**Ordenação:** pela métrica em `processCaptureConfig.compareMetric` (ou on-demand); retorna Top `topX` (1–100). Se `compareMetric` for `gpuUse` ou `vramMb` e o host **não** tiver NVIDIA com nvitop, faz **fallback para `cpuPercent`**.

Cada processo no array inclui **todas** as métricas coletadas (`cpuPercent`, `ramMb`, `vramMb`, `gpuUse`, `diskReadKbps`, `diskWriteKbps`); a métrica de comparação serve apenas para ranquear, não filtra campos.

**Divisão psutil / nvitop:** uma passagem `psutil.process_iter` coleta CPU, RAM e I/O de todos os PIDs; um mapa único `nvitop.Device.processes()` (NVIDIA) enriquece VRAM e `gpuUse` por PID — processos sem GPU ficam com `vramMb`/`gpuUse` = 0.

### 19.6 Heartbeat e inventário

| Função | Biblioteca | API | Consumidor |
|--------|------------|-----|------------|
| `_active_users()` | psutil | `users()` | `connectedUsers[]` (só usernames) |
| `pwd.getpwall()` | stdlib | contas POSIX | `provisionedOsUsers[]` |
| `parse_ssh_line(line)` | regex / arquivo | tail `/var/log/auth.log` | `sshAttempts[]` (buffer) |

**`_active_users()` detalhe:** cada entry inclui `username`, `terminal`, `host`, `isSsh` (host ∉ localhost/:0), `connectedSince` (epoch). Heartbeat envia só a lista de nomes; telemetria envia objetos completos.

### 19.7 Sync-specs (boot, uma vez)

| Função | Biblioteca / origem | Saída |
|--------|---------------------|-------|
| `_cpu_model()` | `/proc/cpuinfo` ou `platform.processor()` | `cpuModel` string |
| `_collect_gpu_specs()` | pynvml name + `_GPU.vram()`; fallback `_gpu_model_lspci()` | `gpuModel`, `totalVramGb` (×10) |
| `_ram_wire()` | psutil `virtual_memory()` | `totalRamGb` (×10) |
| `_local_ip()` | `socket` UDP connect `8.8.8.8:80` | `ipAddress` |
| `_disk_partitions()` | psutil `disk_partitions` + `disk_usage` | `disks[]` + `_partition_role()` |
| `_host_fingerprint()` | subprocess `ssh-keygen -l -f .../ssh_host_ed25519_key.pub` | `hostFingerprint` SHA256 |

**`_gpu_model_lspci()`:** subprocess `lspci -mm`, filtra classe VGA / Display / 3D controller (evita NVMe “3D NAND”).

### 19.8 Backends GPU (`_GpuBackend`)

| Classe | Detecção | Métodos | Fontes |
|--------|----------|---------|--------|
| `_NvidiaBackend` | `pynvml` + `nvitop` | `usage`, `temp`, `vram`, `power`, `gpu_process_metrics` | nvitop utilization/memory/processes; pynvml para nome sync-specs |
| `_AmdSysfsBackend` | glob `gpu_busy_percent` em DRM | idem | sysfs `gpu_busy_percent`, `mem_info_vram_*`, hwmon `power*_average` |
| `_IntelSysfsBackend` | glob `rps_cur_freq_mhz` | `usage` proxy freq ratio; `temp` via psutil sensors | sysfs i915/xe |
| `_NullBackend` | fallback | zeros | Sem GPU mensurável |

**Seleção:** `_detect_gpu_backend()` uma vez no boot; instância global `_GPU`.

**AMD device pick:** `_pick_amd_drm_device_dir()` escolhe card com maior `mem_info_vram_total` (dGPU vs iGPU).

### 19.9 Provisionamento / limpeza (não-telemetria)

| Função | Origem | Papel |
|--------|--------|-------|
| `_user_partition_mountpoints()` | `_disk_partitions()` | Lista mounts `role=user` |
| `_collect_user_remnant_paths(uname)` | pwd + mounts user + `/home` | Paths para `rmtree` pós-`userdel` |
| `_purge_lab_user` / `_purge_all_lab_users` | subprocess `pkill`, `userdel`; `shutil.rmtree` | Drift e descomissionamento |
| `_scan_orphan_lab_dirs()` | `os.listdir` em partições user | Dirs `lab.*` sem passwd |
| `apply_provisioning` | subprocess `useradd`, `usermod`, `chmod`, `chown` | Heartbeat 200 |
| `_maybe_migrate_user_home` | subprocess `pkill`, `usermod -d`; `os.makedirs` | Heartbeat quando `allowHomeMigration` |

### 19.10 Utilitários de formato

| Função | Transformação |
|--------|---------------|
| `_gb_wire(byte_count)` | `round(bytes / 1024³ × 10)` → inteiro GB×10 |
| `_partition_role(mountpoint)` | Heurística system vs user (espelha API `classifyDiskPartitionRole`) |

### 19.11 Mapa função → rota HTTP

```text
sync-specs     ← _cpu_model, _collect_gpu_specs, _ram_wire, _local_ip,
                 _disk_partitions, _host_fingerprint

heartbeat      ← _active_users, pwd.getpwall, parse_ssh_line (buffer)

telemetry      ← collect_telemetry() = todas as entradas §19.1

(provisioning) ← apply_provisioning (sem HTTP de saída; side-effect SO)
```

---


## Referência rápida — arquivos relacionados

| Caminho | Conteúdo |
|---------|----------|
| `apps/agent/agentd.py` | Implementação |
| `apps/agent/.env.example` | Variáveis |
| `apps/api/app/controllers/agent_controller.ts` | Entrada HTTP agente |
| `apps/api/app/services/heartbeat_service.ts` | provisioning, decommission |
| `apps/api/app/services/machine_decommission.ts` | Exclusão admin 2 fases |
| `apps/api/app/services/disk_partitions.ts` | Roles, mainDisk, homeDirectory |
| `apps/api/app/services/allocation_access.ts` | Fases prepare→teardown; `allowHomeMigrationForUser` |
| `apps/api/app/services/telemetry_presets.ts` | Presets eco/fast/custom |
| `apps/api/tests/functional/agent.spec.ts` | Testes contrato agente |
| `apps/web/src/stores/machines.ts` | DELETE com retry 35 s |

---

## Diagrama geral

```text
┌─────────────┐     sync-specs (boot)      ┌─────────────┐
│   agentd    │ ─────────────────────────► │   AdonisJS  │
│   (Linux)   │     heartbeat (30s)        │     API     │
│             │ ◄───────────────────────── │             │
│             │     telemetry (Ns)         │             │
└─────────────┘ ─────────────────────────► └─────────────┘
       │                                           │
       │ useradd/usermod/userdel                   │ allocations
       │ pkill, authorized_keys                    │ machine_users
       ▼                                           ▼
  /etc/passwd                                 PostgreSQL
  /home, /data/*, …                           + Redis/cache
```
