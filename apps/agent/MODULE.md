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
| `homeDirectory` | path absoluto, opcional | `useradd -d` na **criação**; ver [Multi-disco](#9-multi-disco-home-e-conflitos) |

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
| `diskReadMbps` | int | Mbps | `diskIO` | Throughput agregado leitura |
| `diskWriteMbps` | int | Mbps | `diskIO` | Throughput agregado escrita |
| `disksInfo` | array | — | `diskSpace` ou `diskIO` | Por-partição: `device`, `mountpoint`, `totalGb`, `freeGb`, I/O opcional |
| `downloadMbps` | int | Mbps | `networkIO` | Tráfego recebido |
| `uploadMbps` | int | Mbps | `networkIO` | Tráfego enviado |
| `activeUsers` | array | — | `activeUsers` | Sessões `lab.*` (detalhe TTY/SSH) |
| `processes` | array | — | on-demand (5 batches) | Top processos pesados |

**Valores omitidos / null:** Métrica desligada no preset → campo ausente ou `null` (API normaliza para UI `—`).

#### `processes[]` (on-demand)

Disparado quando admin solicita relatório → heartbeat inclui `onDemandProcessConfig.requestTimestamp` → agente seta `PROCESS_BATCHES_REMAINING = 5`.

Thresholds default (`processThresholds` / on-demand):

| Métrica | Limiar | Inclusão |
|---------|--------|----------|
| CPU | ≥ 2% (`cpuPercent` ×10) | OR |
| RAM | ≥ 200 MB | OR |
| VRAM | ≥ 50 MB | OR |
| Disk read | ≥ 1000 Kbps | OR |
| Disk write | ≥ 1000 Kbps | |

Ordenação: VRAM > CPU > RAM > read > write; top `topX` (default 10).

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
| Duas reservas sequenciais, discos diferentes | Home fixo na 1ª criação; admin deve aguardar teardown (`endTime + 7d`) ou remover usuário manualmente |
| Dados órfãos após `userdel` falho parcial | `_scan_orphan_lab_dirs()` remove dirs `lab.*` sem passwd em partições user |
| Admin remove usuário provisionado | DELETE `machine_users` → próximo heartbeat sem item → drift + purge multi-partição |
| Mesmo usuário, duas alocações | API escolhe **fase dominante** (`resolveDominantAccessForUser`) — prevalece `active`/`grace` sobre `no_key` antiga |
| sync-specs atualiza discos | `mergeDiskPartitionsFromAgent` mantém `mainDisk`/`role` admin |

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

1. **NVIDIA** (`pynvml`) — uso, temp, VRAM, power
2. **AMD** (`amdgpu` sysfs) — `gpu_busy_percent`, VRAM, power hwmon
3. **Intel** (i915/xe sysfs) — freq ratio como proxy de uso
4. **_NullBackend** — zeros silenciosos

Multi-GPU: usa índice 0 NVML; comentário no código para iterar `nvmlDeviceGetCount()` se necessário.

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

## Referência rápida — arquivos relacionados

| Caminho | Conteúdo |
|---------|----------|
| `apps/agent/agentd.py` | Implementação |
| `apps/agent/.env.example` | Variáveis |
| `apps/api/app/controllers/agent_controller.ts` | Entrada HTTP agente |
| `apps/api/app/services/heartbeat_service.ts` | provisioning, decommission |
| `apps/api/app/services/machine_decommission.ts` | Exclusão admin 2 fases |
| `apps/api/app/services/disk_partitions.ts` | Roles, mainDisk, homeDirectory |
| `apps/api/app/services/allocation_access.ts` | Fases prepare→teardown |
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
