# Módulo Agente (Lab Agent Daemon)

Documentação de referência do daemon `agentd.py` — comunicação com a API AdonisJS, provisionamento POSIX/SSH, telemetria de hardware e auditoria de segurança.

**Código-fonte:** `apps/agent/agentd.py`  
**Rotas consumidas:** `apps/api/start/routes.ts` → prefixo `/api/v1/agent`  
**Lógica de resposta (heartbeat):** `apps/api/app/services/heartbeat_service.ts`  
**Multi-disco / home na reserva:** `apps/api/app/services/disk_partitions.ts`, `allocation_home_mount.ts`

---

## Sumário

1. [Papel e arquitetura](#1-papel-e-arquitetura)
2. [Requisitos, instalação e operação (systemd)](#2-requisitos-instalação-e-operação-systemd)
3. [Configuração (.env)](#3-configuração-env)
4. [Autenticação](#4-autenticação)
5. [Mapa de rotas da API](#5-mapa-de-rotas-da-api)
6. [GET /api/config — bootstrap de telemetria](#6-get-apiconfig--bootstrap-de-telemetria)
7. [PUT /api/v1/agent/sync-specs](#7-put-apiv1agentsync-specs)
8. [POST /api/v1/agent/heartbeat](#8-post-apiv1agentheartbeat)
9. [POST /api/v1/agent/telemetry](#9-post-apiv1agenttelemetry)
10. [Multi-disco, home e conflitos](#10-multi-disco-home-e-conflitos)
11. [Descomissionamento (exclusão admin)](#11-descomissionamento-exclusão-admin)
12. [Ciclo de vida de alocação](#12-ciclo-de-vida-de-alocação)
13. [Provisionamento no Linux](#13-provisionamento-no-linux)
14. [Telemetria — campos e justificativas](#14-telemetria--campos-e-justificativas)
15. [Threads e loop principal](#15-threads-e-loop-principal)
16. [GPU — backends e detecção](#16-gpu--backends-e-detecção)
17. [Auditoria SSH](#17-auditoria-ssh)
18. [Resiliência e falhas](#18-resiliência-e-falhas)
19. [Hardening no boot](#19-hardening-no-boot)
20. [Catálogo de funções de captura](#20-catálogo-de-funções-de-captura)

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

## 2. Requisitos, instalação e operação (systemd)

O agente foi pensado para rodar como **serviço systemd** em cada máquina do laboratório, iniciando no boot e reiniciando após falhas de rede. Em produção o diretório recomendado é **`/opt/lab-agent`** (independente do clone do repositório).

### 2.1 Requisitos do sistema

| Item | Detalhe |
|------|---------|
| **SO** | Linux apenas — testado em **Ubuntu Server 22.04+** |
| **Usuário do processo** | **root** — `useradd`/`userdel`, `usermod`, leitura de `/var/log/auth.log`, chaves em `/home/lab.*` |
| **Rede** | Saída HTTP(S) até a API; **nenhuma porta inbound** no agente (modelo pull) |
| **SSH** | `openssh-server` ativo; chave host **ed25519** em `/etc/ssh/ssh_host_ed25519_key.pub` (sync-specs envia fingerprint) |
| **Python** | 3.10+ (`python3`, `python3-pip`, `python3-venv` opcional) |
| **Pacotes OS** | `acl` — `setfacl` para root acessar homes `lab.*` via sudo (ver [§2.2.1](#221-pacote-acl-acesso-admin-via-sudo)) |

**Dependências Python** (`requirements.txt`):

```bash
# Mínimo (sem telemetria NVIDIA rica):
pip install psutil requests

# Completo (repo):
pip install -r requirements.txt
```

| Pacote | Função |
|--------|--------|
| `psutil` | CPU, RAM, swap, discos, processos, usuários ativos |
| `requests` | HTTP para a API |
| `nvitop` / `nvidia-ml-py` | GPU NVIDIA (opcional; sem eles CPU/RAM/disco seguem) |

**GPU AMD/Intel:** leitura via sysfs — sem pacotes extras.

### 2.2 Instalação (console)

Substitua `/caminho/Projeto-TCC` pelo clone local e ajuste `SERVER_URL` / `MACHINE_TOKEN`.

```bash
# 1. Pacotes do sistema
sudo apt update
sudo apt install -y python3 python3-pip python3-venv openssh-server acl

# 2. Diretório de implantação
sudo mkdir -p /opt/lab-agent
sudo cp /caminho/Projeto-TCC/apps/agent/agentd.py /opt/lab-agent/
sudo cp /caminho/Projeto-TCC/apps/agent/requirements.txt /opt/lab-agent/
sudo cp /caminho/Projeto-TCC/apps/agent/.env.example /opt/lab-agent/.env

# 3. venv (recomendado)
cd /opt/lab-agent
sudo python3 -m venv venv
sudo venv/bin/pip install --upgrade pip
sudo venv/bin/pip install -r requirements.txt

# 4. Configurar credenciais
sudo nano /opt/lab-agent/.env   # SERVER_URL, MACHINE_TOKEN
sudo chmod 600 /opt/lab-agent/.env
sudo chown root:root /opt/lab-agent/.env

# 5. Chave SSH host ed25519 (se ainda não existir)
sudo test -f /etc/ssh/ssh_host_ed25519_key.pub || \
  sudo ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ""
sudo systemctl reload ssh

# 6. Teste manual (opcional, Ctrl+C para parar)
cd /opt/lab-agent
sudo venv/bin/python3 agentd.py
```

#### 2.2.1 Pacote ACL (acesso admin via sudo)

Homes `lab.*` ficam com **chmod 700** (só o dono). Sem ACL, administradores com `sudo` podem ter dificuldade para **listar ou entrar** no diretório (`ls`, `cd`), embora leitura por caminho absoluto (`sudo cat …/arquivo`) às vezes funcione.

O agente chama `setfacl` a cada provisionamento (heartbeat) em `$HOME` e `$HOME/.ssh`:

```bash
setfacl -m u:root:rx  <path>    # root pode listar e atravessar agora
setfacl -d -m u:root:rx <path>    # entradas novas herdam a mesma regra
```

**Instalação** (já incluído no passo 1 acima):

```bash
sudo apt update
sudo apt install -y acl
```

**Verificar** que o filesystem suporta ACL (ext4/xfs com ACL habilitado — padrão no Ubuntu Server):

```bash
# pacote presente
which setfacl

# montagem com ACL (flag acl no ext4, ou acl sempre no xfs)
mount | grep ' / '
touch /tmp/acl-test && setfacl -m u:root:rx /tmp/acl-test && getfacl /tmp/acl-test && rm /tmp/acl-test
```

**Conferir numa home provisionada:**

```bash
getfacl /data/lab.aluno
# user:root:r-x  deve aparecer
sudo ls -la /data/lab.aluno
```

**O que não muda:** modo Unix continua **700** / **600** — outros usuários `lab.*` **não** ganham acesso mútuo. Só **root** recebe `rx` via ACL.

**Requisito operacional:** o pacote `acl` deve estar instalado **antes** de provisionar contas; o agente não instala pacotes nem corrige homes antigas no boot — ACL é reaplicada quando o heartbeat provisiona o usuário.

**Token:** gerado no cadastro da máquina no admin ou `POST /api/v1/machines/:id/regenerate-token`. Após rotacionar, editar `.env` e reiniciar o serviço.

### 2.3 Unit systemd

Arquivo `/etc/systemd/system/lab-agent.service`:

```ini
[Unit]
Description=Lab Agent Daemon (TCC UFPel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/lab-agent
EnvironmentFile=-/opt/lab-agent/.env
ExecStart=/opt/lab-agent/venv/bin/python3 /opt/lab-agent/agentd.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Sem venv, use `ExecStart=/usr/bin/python3 /opt/lab-agent/agentd.py`.

**Variáveis de ambiente:** o agente lê `.env` ao lado de `agentd.py` no import (`_load_dotenv`). O `EnvironmentFile=` do systemd é equivalente; se ambos existirem, **variáveis já presentes no ambiente (systemd) prevalecem**.

**Ativar no boot:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable lab-agent
sudo systemctl start lab-agent
sudo systemctl status lab-agent
```

### 2.4 Operação do dia a dia

| Ação | Comando |
|------|---------|
| Ver status | `systemctl status lab-agent` |
| Parar | `sudo systemctl stop lab-agent` |
| Iniciar | `sudo systemctl start lab-agent` |
| Reiniciar (após update de código ou `.env`) | `sudo systemctl restart lab-agent` |
| Desabilitar no boot | `sudo systemctl disable lab-agent` |
| Logs ao vivo | `sudo journalctl -u lab-agent -f` |
| Últimas 200 linhas | `sudo journalctl -u lab-agent -n 200 --no-pager` |

**Atualizar o binário:**

```bash
sudo cp /caminho/novo/agentd.py /opt/lab-agent/
sudo systemctl restart lab-agent
```

### 2.5 Desinstalação

```bash
sudo systemctl stop lab-agent
sudo systemctl disable lab-agent
sudo rm -f /etc/systemd/system/lab-agent.service
sudo systemctl daemon-reload
sudo rm -rf /opt/lab-agent
```

Isso **não** remove contas `lab.*` já provisionadas — use descomissionamento pelo admin ou remoção manual (`userdel`) em ambiente de teste.

### 2.6 Logs no console e o serviço systemd

O agente usa **`print()`** para diagnóstico (`[C2]`, `[OS]`, `[Telemetry]`, `[Specs]`, etc.) — não há módulo `logging` separado.

**Isso não interfere no funcionamento do daemon.** Os `print` vão para **stdout/stderr**; com `Type=simple`, o systemd captura essa saída no **journal** (`journalctl -u lab-agent`). Heartbeat, telemetria e auditoria rodam em **threads daemon** independentes da escrita no console.

| Aspecto | Comportamento |
|---------|---------------|
| Operação normal | Prints são apenas telemetria operacional para o administrador |
| Falha de rede | `[C2] Erro no Heartbeat` / `[Telemetry] Erro de rede` — o loop continua |
| Volume | Eco (~1 lote/min) gera poucas linhas; preset **fast** aumenta mensagens de telemetria no journal |
| Parada via systemd | `systemctl stop` envia **SIGTERM**; o código só trata `KeyboardInterrupt` (execução manual) — encerramento é abrupto mas seguro (threads daemon) |
| Produção | Opcional: `StandardOutput=journal` / rotação de journal (`journald.conf`) se o disco for apertado |

Para desenvolvimento, rodar `sudo python3 agentd.py` no terminal mostra os mesmos prefixos em tempo real; como serviço, o conteúdo equivalente aparece no journal.

### 2.7 Checklist pós-instalação

1. `systemctl is-active lab-agent` → `active`
2. `journalctl -u lab-agent` sem loop de `401` / token inválido
3. Admin: máquina com **last seen** ~30 s
4. `sync-specs` no boot: linha `[Specs] ✓ Hardware registrado` no journal

---

## 3. Configuração (.env)

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

## 4. Autenticação

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

## 5. Mapa de rotas da API

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

## 6. GET /api/config — bootstrap de telemetria

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

## 7. PUT /api/v1/agent/sync-specs

**Quando:** Uma vez após boot (thread principal, antes das workers).

**Objetivo:** Registrar hardware **estável** no banco. Telemetria dinâmica (uso %) não passa por aqui.

### Política de sobreposição na API (`applySyncSpecsIfEmpty`)

Cada campo de spec só é gravado se estiver **vazio** no banco (`null`, string em branco ou wire GB ≤ 0). Se o admin já preencheu CPU, RAM, disco, IP etc., o sync **mantém** o valor admin. Se o admin **limpar** o campo, o próximo boot do agente repreenche.

**Exceções:** `publicIpAddress` e política de discos (`mainDisk`, `allocatable`) são exclusivos do painel admin — o agente não os envia.

### Request (corpo JSON)

| Campo | Tipo | Origem no agente | Justificativa |
|-------|------|------------------|---------------|
| `cpuModel` | string | `/proc/cpuinfo` → `model name` | Identificação no painel e relatórios |
| `gpuModel` | string? | NVML (NVIDIA) ou `lspci -mm` | Exibição; fallback quando driver não expõe nome |
| `totalRamGb` | int | `psutil.virtual_memory().total` → **GB×10** | Formato wire único (155 = 15,5 GB) |
| `totalVramGb` | int? | `_GPU.vram()` total → GB×10 | Omitido se iGPU / VRAM dedicada = 0 |
| `totalDiskGb` | int | Disco raiz (`/` ou principal) → **GB×10** | Spec de capacidade total; distinta da soma de partições |
| `ipAddress` | string? | UDP connect trick / interface local | **IP local** da estação |
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

**API:** `mergeDiskPartitionsFromAgent` preserva flags admin (`mainDisk`, `allocatable`) ao atualizar `totalGb`/`freeGb`. Capacidade ao vivo também é refrescada por `disksInfo` na telemetria (`mergeDiskPartitionsFromTelemetry`).

### Response 200

```json
{
  "synced": true,
  "machine": { "id", "name", "cpuModel", "gpuModel", "totalVramGb", "totalRamGb", "totalDiskGb" }
}
```

---

## 8. POST /api/v1/agent/heartbeat

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

## 9. POST /api/v1/agent/telemetry

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

**Valores omitidos / null:** Métrica desligada no preset → campo **ausente ou `null`** na amostra (API persiste null; UI `—`). **Não** enviar `0` como substituto de “desligado” para temperaturas ou toggles off.

Temperaturas: `cpuTemp`, `moboTemp`, `gpuTemp` só coletadas com toggle `temperatures` / GPU ativo; caso contrário omitidas.

#### `disksInfo[]` (telemetria)

Inclui `totalGb`, `freeGb`, `usagePct` (wire ×10), I/O opcional. API mescla na última amostra do lote para atualizar `machines.disks`.

#### `processes[]` (captura contínua ou on-demand)

Quando `telemetrySet.processCapture` está ativo, o agente envia o Top X a cada amostra, ordenado pela métrica configurada em `processCaptureConfig.compareMetric` e filtrado por `processCaptureConfig.userScope`.

| `userScope` | Comportamento |
|-------------|---------------|
| `session` | Apenas processos de `lab.*` com sessão TTY/SSH ativa (`psutil.users()`). **Sem sessão lab. conectada, a amostra não inclui `processes`** (lista vazia no agente → omitida na API → front sem linhas). |
| `all` | Top X de todo o host (qualquer usuário POSIX) |

Gatilho on-demand (`POST /machines/:id/request-processes`) dispara 5 batches extras com `compareMetric`, `topX` e `userScope`.

**Compatibilidade legado:** pedidos pendentes gravados antes do refactor usam `thresholds: { cpuPercent, ramMb, vramMb, diskReadKbps, diskWriteKbps, topX }` (limiares mínimos OR + ordenação fixa VRAM > CPU > RAM > I/O). O agente mapeia para o modelo Top-X: `topX` é lido de `thresholds.topX`; `compareMetric` infere-se pelo primeiro limiar não-default nessa ordem de prioridade (padrão `vramMb`); `userScope` passa a `all` (equivalente ao scan de host antigo, exceto root/systemd/messagebus). Não reproduz o filtro OR exato — apenas preserva a intenção de ordenação e o Top X solicitado.

| Campo | Wire | Descrição |
|-------|------|-----------|
| `cpuPercent` | int ×10 | % da capacidade total do host (psutil bruto ÷ CPUs lógicas; máx. 100%) |
| `ramMb` | int | RAM RSS em MB |
| `vramMb` | int? | VRAM em MB (NVIDIA via nvitop); omitido se 0 |
| `gpuUse` | int ×10? | Uso SM da GPU; omitido se 0 |
| `diskReadKbps` | int? | Leitura de disco; omitido se 0 |
| `diskWriteKbps` | int? | Escrita de disco; omitido se 0 |

Métricas de comparação disponíveis: `cpuPercent`, `ramMb`, `vramMb`, `gpuUse`, `diskReadKbps`, `diskWriteKbps`.

---

## 10. Multi-disco, home e conflitos

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

## 11. Descomissionamento (exclusão admin)

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

## 12. Ciclo de vida de alocação

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

## 13. Provisionamento no Linux

### Conta

- Prefixo `lab.` + `users.system_username`
- Grupo `lab` (`groupadd -f lab` no boot)
- UMASK 077 via `login.defs` + `useradd -K UMASK=0077`
- Permissões: home `700`, `.ssh` `700`, `authorized_keys` `600`
- Partições de dados: `_ensure_home_mount_parent()` cria pais ausentes (`755 root:root`) antes de `useradd -d` — ex. `/data` para home `/data/lab.aluno`
- ACL admin: `_grant_root_home_access()` → `setfacl u:root:rx` em home e `.ssh` (requer pacote `acl`; ver [§2.2.1](#221-pacote-acl-acesso-admin-via-sudo)). **Só root** — outros `lab.*` não ganham acesso cruzado
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

## 14. Telemetria — campos e justificativas

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

Implementação detalhada de cada coletor: [§20 Catálogo de funções de captura](#20-catálogo-de-funções-de-captura).

---

## 15. Threads e loop principal

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

## 16. GPU — backends e detecção

Ordem em `_detect_gpu_backend()`:

1. **NVIDIA** (`nvitop` + `pynvml`) — uso GPU/VRAM/processos via **nvitop**; nome da placa em sync-specs via pynvml. **Compatível com placas NVIDIA suportadas pelo driver/NVML moderno; modelos muito antigos podem não expor métricas via nvitop** (uso GPU e `gpuUse` por processo ficam ausentes/zerados).
2. **AMD** (`amdgpu` sysfs) — `gpu_busy_percent`, VRAM, power hwmon
3. **Intel** (i915/xe sysfs) — freq ratio como proxy de uso
4. **_NullBackend** — zeros silenciosos

Multi-GPU: usa índice 0; comentário no código para iterar dispositivos se necessário.

---

## 17. Auditoria SSH

- Arquivo: `/var/log/auth.log` (hardcoded — typical Debian/Ubuntu)
- Rotação: detecta mudança de inode → reopen
- Boot: `seek END` — não reenvia histórico antigo
- Parser: `parse_ssh_line` — ignora linhas sem `sshd`

Eventos gravados em `ssh_connection_attempts` (API) + notificação flood (`checkSshFailureFlood`).

---

## 18. Resiliência e falhas

| Evento | SO | API | Agente (processo) |
|--------|----|----|-------------------|
| API offline | Congela último estado | Fases avançam por tempo | Exceção logada; retry 30 s |
| Reboot máquina | Persiste passwd/keys | `lastSeenAt` stale → offline efetivo | Restart → sync-specs + heartbeat |
| Token inválido | Congela | — | 401 → **não** purge (segurança) |
| pendingRemoval | Purge no próximo 200 | Aguarda 2º DELETE | `_purge_all_lab_users` |

**Dessincronia esperada:** UI pode mostrar fase `post_sftp` enquanto SO ainda tem bash até próximo heartbeat 200.

---

## 19. Hardening no boot

Idempotente em `main()`:

1. `groupadd -f lab`
2. Substitui `UMASK` em `/etc/login.defs` por `077`

Falhas logadas como aviso — daemon continua.

**Fora do boot:** ACL de root nas homes (`_grant_root_home_access`) roda em **`apply_provisioning`** e **`_maybe_migrate_user_home`**, a cada heartbeat que reconcilia usuários — não na subida do daemon.

---

## 20. Catálogo de funções de captura

Referência de **todas** as funções de coleta em `agentd.py`: origem dos dados (psutil, sysfs, NVML, subprocess, etc.), rota/consumidor e formato wire.

### 20.1 Telemetria periódica (`collect_telemetry`)

| Função / chamada | Biblioteca / origem | API psutil / SO | Campo(s) wire | `telemetrySet` | Justificativa |
|------------------|---------------------|-----------------|---------------|----------------|---------------|
| `psutil.cpu_percent(interval=None)` | psutil | CPU global instantânea | `cpuUsage` (×10) | `cpu` | Carga agregada do host; `interval=None` usa delta desde última chamada |
| `psutil.cpu_freq(percpu=False)` | psutil | Frequência atual MHz | `cpuFreqMhz` | `cpu` | Contexto turbo/throttle junto com uso |
| `_read_temperatures()` | psutil | `sensors_temperatures()` | `cpuTemp`, `moboTemperature` (×10) | `temperatures` | Ver §20.2 |
| `_ram_wire()` | psutil | `virtual_memory()` total/available | `ramTotalGb`, `ramUsedGb` (×10) | `ramAndSwap` | Pressão de RAM |
| `_swap_wire()` | psutil | `swap_memory()` total/used | `swapTotalGb`, `swapUsedGb` (×10) | `ramAndSwap` | Swap em uso |
| `_GPU.usage()` | backend GPU | nvitop (NVIDIA) / sysfs AMD/Intel | `gpuUsage` (×10) | `gpu` | Utilização GPU; NVIDIA exige nvitop |
| `_GPU.temp()` | backend GPU | NVML / `sensors_temperatures` amdgpu | `gpuTemp` (×10) | `gpu` | Termal GPU |
| `_GPU.power()` | backend GPU | NVML mW / AMD hwmon µW | `gpuPowerWatts` (int W) | `gpu` | Consumo elétrico |
| `_GPU.vram()` | backend GPU | NVML mem / AMD mem_info_vram_* | `vramTotalGb`, `vramUsedGb` (×10) | `gpu` | Memória dedicada; omitido se total=0 (iGPU) |
| `_net_delta()` | psutil | `net_io_counters()` + delta monotonic | `downloadMbps`, `uploadMbps` | `networkIO` | Ver §20.3 |
| `_disk_metrics(space, io)` | psutil | `disk_partitions`, `disk_usage`, `disk_io_counters` | `diskReadMbps`, `diskWriteMbps`, `disksInfo[]` | `disk` | Espaço e I/O juntos |
| `_active_users()` | psutil | `users()` filtrado `lab.*` | `activeUsers[]` | `activeUsers` | Sessões TTY/SSH provisionadas |
| `_get_top_processes()` | psutil + nvitop | `process_iter` + nvitop `Device.processes()` | `processes[]` | `processCapture` | Ver §20.5 |

**Aquecimento:** `telemetry_worker` chama `psutil.cpu_percent(interval=None)` uma vez antes do loop para estabilizar a primeira leitura de CPU.

### 20.2 `_read_temperatures()`

| Sensor psutil | Chave típica | Campo | Fallback |
|---------------|--------------|-------|----------|
| CPU package | `coretemp`, `k10temp`, `cpu_thermal` | `cpuTemp` — **max** dos entries | `acpitz[0]` |
| Placa-mãe | `acpitz` (se CPU já leu) | `moboTemp` | `null` |

GPU **não** entra aqui — temperatura GPU vem exclusivamente de `_GPU.temp()` para evitar duplicata.

### 20.3 `_net_delta()`

- **Entrada:** `psutil.net_io_counters()` → `bytes_recv`, `bytes_sent`
- **Estado:** cache global `_net_prev` com `{ t, recv, sent }` e `time.monotonic()`
- **Cálculo:** `(Δbytes × 8) / 1_000_000 / Δt` → Mbps arredondado
- **Primeira amostra:** retorna `0, 0` (sem delta anterior)

### 20.4 `_disk_metrics(collect_space, collect_io)`

| Passo | API | Detalhe |
|-------|-----|---------|
| I/O agregado | `disk_io_counters()` | `total_read`, `total_write` → Mbps host |
| I/O por disco | `disk_io_counters(perdisk=True)` | Chave = último segmento de `part.device` |
| Partições | `disk_partitions(all=False)` | Filtra `fstype` ∈ `real_fs` |
| Espaço | `disk_usage(mountpoint)` | Por mount: `usagePct` (×10), `freeGb` |
| Per-part I/O | delta vs `_disk_io_prev["disks"]` | `readMbps`, `writeMbps` em `disksInfo[]` |

**Cache:** `_disk_io_prev` guarda timestamp, totais e bytes por `dev_name` para deltas entre amostras.

**Sync-specs vs telemetria:** `_disk_partitions()` (boot) envia `device`, `fstype`, `totalGb`, `freeGb`, `role`; telemetria envia `usagePct` + I/O opcional sem repetir `device` em todos os presets.

### 20.5 `_get_top_processes(compare_metric, top_x)`

| Fonte | Campos lidos | Uso |
|-------|--------------|-----|
| `nvitop.Device.processes()` | PID → VRAM MB, SM % (`gpuUse` ×10) | Somente NVIDIA com nvitop |
| `psutil.process_iter([...])` | `pid`, `name`, `username`, `cpu_percent`, `memory_info`, `io_counters` | Host inteiro ou filtrado por sessão |
| `_active_users()` + `_session_lab_usernames()` | usernames `lab.*` conectados | Filtro quando `userScope=session` |
| Delta I/O | cache `_process_io_prev` por PID | `diskReadKbps`, `diskWriteKbps` |

**Ordenação:** pela métrica em `processCaptureConfig.compareMetric` (ou on-demand); retorna Top `topX` (1–100). Se `compareMetric` for `gpuUse` ou `vramMb` e o host **não** tiver NVIDIA com nvitop, faz **fallback para `cpuPercent`**.

Cada processo no array inclui **todas** as métricas coletadas (`cpuPercent`, `ramMb`, `vramMb`, `gpuUse`, `diskReadKbps`, `diskWriteKbps`); a métrica de comparação serve apenas para ranquear, não filtra campos.

**Divisão psutil / nvitop:** uma passagem `psutil.process_iter` coleta CPU, RAM e I/O de todos os PIDs; um mapa único `nvitop.Device.processes()` (NVIDIA) enriquece VRAM e `gpuUse` por PID — processos sem GPU ficam com `vramMb`/`gpuUse` = 0.

### 20.6 Heartbeat e inventário

| Função | Biblioteca | API | Consumidor |
|--------|------------|-----|------------|
| `_active_users()` | psutil | `users()` | `connectedUsers[]` (só usernames) |
| `pwd.getpwall()` | stdlib | contas POSIX | `provisionedOsUsers[]` |
| `parse_ssh_line(line)` | regex / arquivo | tail `/var/log/auth.log` | `sshAttempts[]` (buffer) |

**`_active_users()` detalhe:** cada entry inclui `username`, `terminal`, `host`, `isSsh` (host ∉ localhost/:0), `connectedSince` (epoch). Heartbeat envia só a lista de nomes; telemetria envia objetos completos.

### 20.7 Sync-specs (boot, uma vez)

| Função | Biblioteca / origem | Saída |
|--------|---------------------|-------|
| `_cpu_model()` | `/proc/cpuinfo` ou `platform.processor()` | `cpuModel` string |
| `_collect_gpu_specs()` | pynvml name + `_GPU.vram()`; fallback `_gpu_model_lspci()` | `gpuModel`, `totalVramGb` (×10) |
| `_ram_wire()` | psutil `virtual_memory()` | `totalRamGb` (×10) |
| `_local_ip()` | `socket` UDP connect `8.8.8.8:80` | `ipAddress` |
| `_disk_partitions()` | psutil `disk_partitions` + `disk_usage` | `disks[]` + `_partition_role()` |
| `_host_fingerprint()` | subprocess `ssh-keygen -l -f .../ssh_host_ed25519_key.pub` | `hostFingerprint` SHA256 |

**`_gpu_model_lspci()`:** subprocess `lspci -mm`, filtra classe VGA / Display / 3D controller (evita NVMe “3D NAND”).

### 20.8 Backends GPU (`_GpuBackend`)

| Classe | Detecção | Métodos | Fontes |
|--------|----------|---------|--------|
| `_NvidiaBackend` | `pynvml` + `nvitop` | `usage`, `temp`, `vram`, `power`, `gpu_process_metrics` | nvitop utilization/memory/processes; pynvml para nome sync-specs |
| `_AmdSysfsBackend` | glob `gpu_busy_percent` em DRM | idem | sysfs `gpu_busy_percent`, `mem_info_vram_*`, hwmon `power*_average` |
| `_IntelSysfsBackend` | glob `rps_cur_freq_mhz` | `usage` proxy freq ratio; `temp` via psutil sensors | sysfs i915/xe |
| `_NullBackend` | fallback | zeros | Sem GPU mensurável |

**Seleção:** `_detect_gpu_backend()` uma vez no boot; instância global `_GPU`.

**AMD device pick:** `_pick_amd_drm_device_dir()` escolhe card com maior `mem_info_vram_total` (dGPU vs iGPU).

### 20.9 Provisionamento / limpeza (não-telemetria)

| Função | Origem | Papel |
|--------|--------|-------|
| `_user_partition_mountpoints()` | `_disk_partitions()` | Lista mounts `role=user` |
| `_collect_user_remnant_paths(uname)` | pwd + mounts user + `/home` | Paths para `rmtree` pós-`userdel` |
| `_purge_lab_user` / `_purge_all_lab_users` | subprocess `pkill`, `userdel`; `shutil.rmtree` | Drift e descomissionamento |
| `_scan_orphan_lab_dirs()` | `os.listdir` em partições user | Dirs `lab.*` sem passwd |
| `apply_provisioning` | subprocess `useradd`, `usermod`, `chmod`, `chown` | Heartbeat 200 |
| `_maybe_migrate_user_home` | subprocess `pkill`, `usermod -d`; `os.makedirs` | Heartbeat quando `allowHomeMigration` |

### 20.10 Utilitários de formato

| Função | Transformação |
|--------|---------------|
| `_gb_wire(byte_count)` | `round(bytes / 1024³ × 10)` → inteiro GB×10 |
| `_partition_role(mountpoint)` | Heurística system vs user (espelha API `classifyDiskPartitionRole`) |

### 20.11 Mapa função → rota HTTP

```text
sync-specs     ← _cpu_model, _collect_gpu_specs, _ram_wire, _local_ip,
                 _disk_partitions, _host_fingerprint

heartbeat      ← _active_users, pwd.getpwall, parse_ssh_line (buffer)

telemetry      ← collect_telemetry() = todas as entradas §20.1

(provisioning) ← apply_provisioning (sem HTTP de saída; side-effect SO)
```

---


## Referência rápida — arquivos relacionados

| Caminho | Conteúdo |
|---------|----------|
| `apps/agent/agentd.py` | Implementação |
| `apps/agent/.env.example` | Variáveis e exemplo systemd |
| `apps/api/app/controllers/agent_controller.ts` | Entrada HTTP agente |
| `apps/api/app/services/heartbeat_service.ts` | provisioning, decommission |
| `apps/api/app/services/machine_decommission.ts` | Exclusão admin 2 fases |
| `apps/api/app/services/machine_specs_merge.ts` | Fill-empty no sync-specs |
| `apps/api/app/services/disk_partitions.ts` | Roles, mainDisk, homeDirectory, merge telemetria |
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
  /etc/passwd                                 SQLite
  /home, /data/*, …                           (API)
```

---

## Mudanças recentes (jun/2026)

| Área | Alteração |
|------|-----------|
| sync-specs | Envia `totalDiskGb`; API aplica **fill-empty** (`applySyncSpecsIfEmpty`) |
| Telemetria | Métricas off → `null`/omitido; `cpuUsage` condicionado ao toggle `cpu` |
| Processos | `cpuPercent` normalizado ÷ CPUs lógicas; campos 0 omitidos (`vramMb`, I/O…) |
| Discos | `disksInfo` inclui `totalGb`; API atualiza `machines.disks` por lote |
| Logs | Falha no POST de telemetria exibe status + trecho do corpo da resposta |
| Implantação | Documentação systemd em [§2](#2-requisitos-instalação-e-operação-systemd) |
