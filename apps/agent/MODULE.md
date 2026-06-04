# Módulo Agente (Lab Agent Daemon)

## Papel e Arquitetura

O agente roda localmente nas máquinas físicas do laboratório operando num modelo de **State Enforcement (Pull Model)**. Ele não aguarda conexões; ele ativamente consulta a API e aplica o estado desejado no Sistema Operacional Linux.

Ele é responsável por:

1. **Provisionamento Dinâmico:** Criar usuários no Linux (`useradd`), injetar chaves públicas (`authorized_keys`) e aplicar regras de exclusão (`userdel`).
2. **Controle de Acesso:** Alternar o shell do usuário entre Bash (`/bin/bash` - liberado) e SFTP (`/usr/lib/sftp-server` - bloqueado) com base no horário da alocação.
3. **Gerenciamento de Processos:** Executar `pkill -u <user>` no exato fim de uma sessão para limpar processos órfãos.
4. **Telemetria de Hardware:** Monitorar CPU, RAM, Swap, Discos, VRAM, Temperatura e Potência da GPU.
5. **Auditoria de Segurança:** Fazer _parsing_ do log de SSH (`/var/log/auth.log`) para detectar invasões e listar processos pesados rodando.

## Variantes

Atualmente, o projeto foca no **Agente Servidor (Linux)**: opera headless (sem interface gráfica), manipulando usuários POSIX e conexões SSH/SFTP.

---

## Ciclos de Comunicação (Polling)

O agente utiliza exclusivamente três rotas da API central. Todas exigem o header `Authorization: Bearer <TOKEN>` da máquina.

### 1. `PUT /api/v1/agent/sync-specs` (Setup de Boot)

Envia, entre outros, `totalVramGb` e `totalRamGb` como **inteiro GB×10** (ex.: 12,0 GB VRAM → `120`; 15,5 GB RAM → `155`), alinhado à telemetria. VRAM/modelo vêm do backend do vendor (`_collect_gpu_specs`: NVML na NVIDIA, sysfs AMD, lspci como fallback). iGPU sem VRAM dedicada omite `totalVramGb`.

Executada **apenas uma vez** quando o `agentd.py` inicia.

- **O que faz:** Lê informações físicas e fixas — Modelo da CPU, Modelo da GPU, Total de RAM e Partições de Disco.
- **Por que existe:** Garante que a base de dados do laboratório reflete a realidade do hardware atual, mesmo que a máquina tenha recebido um upgrade de memória.

### 2. `POST /api/v1/agent/heartbeat` (Comando e Controle)

Executada em ciclo contínuo a cada **30 segundos** (intervalo fixo, não alterável).

- **O que envia (Agente → API):**
  - `connectedUsers`: Contas `lab.*` logadas ativamente via TTY ou SSH (demais usuários do SO são ignorados).
  - `provisionedOsUsers`: Lista de contas `lab.*` que existem no `passwd` do Linux (base para o Drift Detection).
  - `sshAttempts`: Array de até **50** logs extraídos do `/var/log/auth.log` (invasões, falhas, etc). Enviado apenas quando acumula 20 tentativas ou bate meio-dia (12:00 UTC).

- **O que recebe (API → Agente):**
  - `agentConfig.telemetry`: Cadência e conteúdo ditados pelo admin na API (`telemetry_preset`: `fast` | `eco` | `custom`; em `custom`, o JSON `custom_agent_config` define `intervalSeconds`, `batchSize`, `telemetrySet`, etc.).
  - `provisioning`: Array de usuários que precisam existir na máquina, com suas chaves SSH e `accessState` (`full_shell` ou `sftp_only`).

### 3. `POST /api/v1/agent/telemetry` (Fluxo de Dados Dinâmico)

Executada de forma variável, com cadência ditada pelo `agentConfig` recebido no Heartbeat.

- **O que faz:** Entrega métricas brutas (Uso, Temperatura, Potência) de CPU e GPU, além de processos em execução com alta carga (threshold: **>5% CPU** ou **>500 MB RAM**).

---

## Fluxo de Comando e Controle (Heartbeat)

O Heartbeat é o cérebro do laboratório. O Python diz à API "o que está acontecendo", a API calcula o _Drift_ (desvio da realidade) e devolve "o que deve ser feito".

### Payload de Request (Agente → API)

```json
{
  "connectedUsers": ["lab.gabriel_weiand"],
  "provisionedOsUsers": ["lab.gabriel_weiand", "lab.aluno_dois"],
  "sshAttempts": [
    {
      "sourceIp": "192.168.1.100",
      "targetUsername": "root",
      "status": "failed",
      "authMethod": "password"
    }
  ]
}
```

### Payload de Resposta (API → Agente)

```json
{
  "status": "acknowledged",
  "agentConfig": {
    "telemetry": {
      "intervalSeconds": 5,
      "batchSize": 10,
      "telemetryPreset": "complete"
    }
  },
  "provisioning": [
    {
      "systemUsername": "lab.aluno_t5",
      "sshPublicKey": "ssh-ed25519 AAAAC3...",
      "accessState": "sftp_only"
    },
    {
      "systemUsername": "lab.gabriel_weiand",
      "sshPublicKey": "ssh-ed25519 AAAAC3...",
      "accessState": "full_shell"
    }
  ]
}
```

- `sftp_only`: preparação T-N, janela SFTP pós-reserva, ou bloqueio sem bash.
- `full_shell`: sessão ativa ou grace (bash até `graceEndsAt`).
- `revokeSshKey: true` / `sshPublicKey` vazio: agente trunca `~/.ssh/authorized_keys` (fase `no_key`).

Os instantes `graceEndsAt` e `sftpEndsAt` também vêm em `currentAllocation` quando há sessão “quente” (`active` ou `grace`).

### Ação do Agente com a Resposta

1. **Configuração Dinâmica:** Ajusta o intervalo da Thread de Telemetria com base no `agentConfig`.
2. **Reconciliação (Drift):** Se a API não listou um usuário que estava em `provisionedOsUsers`, o agente roda `userdel` e `pkill` nele.
3. **Execução de Políticas:** Para cada item em `provisioning`, o agente garante que:
   - A conta existe e a chave SSH bate com o arquivo local.
   - Transição `full_shell` → `sftp_only`: `pkill -u` antes de `usermod -s`.
   - Se `accessState == sftp_only`, shell → SFTP; se `full_shell`, shell → `/bin/bash`.
   - Se `revokeSshKey` ou chave vazia, trunca `authorized_keys`.
   - `provisioning: []` ainda executa drift (remove `lab.*` não listados).

---

## Fluxo de Telemetria (Data-Heavy)

Para otimizar o I/O do banco de dados, o agente empacota (_batching_) várias leituras e as envia juntas para a API com a cadência definida pelo Heartbeat.

### Payload de Telemetria

```json
{
  "data": [
    {
      "timestamp": "2026-06-15T17:30:00.000Z",
      "cpuUsage": 450,
      "cpuTemp": 650,
      "cpuFreqMhz": 4200,
      "gpuUsage": 800,
      "gpuTemp": 700,
      "gpuPowerWatts": 150,
      "ramTotalGb": 320,
      "ramUsedGb": 165,
      "vramTotalGb": 120,
      "vramUsedGb": 45,
      "diskReadMbps": 300,
      "diskWriteMbps": 150,
      "downloadMbps": 50,
      "uploadMbps": 10,
      "processes": [
        {
          "pid": 1234,
          "name": "python3",
          "username": "lab.gabriel_weiand",
          "cpuPercent": 850,
          "ramGb": 10
        }
      ]
    }
  ]
}
```

### Convenção de Precisão Numérica

| Campo                                | Transmissão           | Valor real → Wire                   |
| ------------------------------------ | --------------------- | ----------------------------------- |
| Porcentagem (CPU, GPU, `cpuPercent`) | Inteiro × 10          | `45.0%` → `450`                     |
| Temperatura                          | Inteiro × 10          | `65.0 °C` → `650`                   |
| Gigabytes (RAM, VRAM, `ramGb`)       | Inteiro × 10          | `16.5 GB` → `165` / `5.6 GB` → `56` |
| Potência GPU                         | Inteiro direto (W)    | `150 W` → `150`                     |
| I/O de rede/disco                    | Inteiro direto (Mbps) | `300 Mbps` → `300`                  |

> **Regra de memória:** todos os campos de gigabytes (`ramTotalGb`, `ramUsedGb`, `vramTotalGb`, `vramUsedGb`, `ramGb` em processos) representam o valor real em GB com **uma casa decimal**, transmitido como inteiro × 10. Ou seja, o wire value `56` significa `5.6 GB`, `320` significa `32.0 GB`. Potência e I/O de rede/disco são os únicos inteiros diretos.

### Threshold de Captura de Processos

Um processo só entra no array `processes` se satisfizer **ao menos um** dos critérios:

- CPU acima de **5%** (`cpuPercent > 50` no formato inteiro × 10)
- RAM acima de **0.5 GB** (`ramGb > 5` no formato inteiro × 10)

---

## Ciclo de Vida do Agente

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           1. BOOT DA MÁQUINA                                    │
│  - Lê .env (SERVER_URL, MACHINE_TOKEN)                                          │
│  - GET /api/config → telemetria inicial eco (ou presets do lab se API online)   │
│  - PUT /api/v1/agent/sync-specs (Registra Hardware no Backend)                  │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                           2. LOOP PRINCIPAL (Daemon)                            │
│                                                                                 │
│  [Thread 1] A cada 30s: POST /api/v1/agent/heartbeat                            │
│    ├─ Envia tentativas do /var/log/auth.log e usuários logados                  │
│    └─ Recebe Ordens: Ajusta useradd, authorized_keys e usermod -s               │
│                                                                                 │
│  [Thread 2] A cada X segundos (Ajustado via Heartbeat): POST /api/v1/agent/telemetry │
│    ├─ Coleta NVML / sysfs / psutil                                              │
│    └─ Envia Buffer para o AdonisJS consolidar.                                  │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                           3. EVENTOS DINÂMICOS                                  │
│  - Preparação T-5: API manda criar usuário antecipado, Agente trava via SFTP.   │
│  - Hora da Alocação: API envia full_shell, Agente libera terminal SSH (Bash).   │
│  - Fim da Alocação: API tira full_shell, Agente fecha terminal e roda pkill -u. │
│  - Acesso Ilegal: API corta acesso, Agente expulsa usuário.                     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Ciclo de vida completo de uma alocação (API → Agente)

A API **não empurra eventos** para o agente. A cada heartbeat (~30s) ela recalcula, para cada máquina, quais alocações `approved` ou `finished` ainda exigem conta Linux e qual **fase de acesso** cada usuário está. O serviço `#services/allocation_access` define as fases; o `#services/heartbeat_service` monta o array `provisioning`; o `agentd.py` aplica no SO.

Variáveis (padrões em `apps/api/.env.example`):

| Variável | Padrão | Papel |
|----------|--------|--------|
| `LAB_ALLOCATION_PREPARE_MINUTES` | 5 | T-N: conta + chave, shell SFTP antes do `startTime` |
| `LAB_ALLOCATION_GRACE_MINUTES` | 10 | Bash extra após `endTime` (só `approved`, não `finished`) |
| `LAB_ALLOCATION_POST_SFTP_MINUTES` | 1440 | SFTP **com chave** após o grace (ou após `endTime` se finalizou cedo) |
| `LAB_ALLOCATION_DELETE_USER_DAYS` | 7 | Conta some do `provisioning` → drift faz `userdel` |
| *(via grace)* | — | Intervalo entre reservas = `LAB_ALLOCATION_GRACE_MINUTES` (API) |

### Fases de acesso (`resolveAccessPhase`)

Referência temporal: sempre o `endTime` gravado na alocação (UTC), exceto onde indicado.

**Reserva `approved` (término natural no horário reservado):**

```
startTime - prepare          → prepare
[startTime, endTime)         → active
[endTime, endTime + grace)   → grace        (full_shell; botão estender)
[endTime+grace, sftpEndsAt)  → post_sftp    (sftp_only + chave)
[sftpEndsAt, endTime + 7d)   → no_key       (sftp_only, revokeSshKey)
[≥ endTime + 7d]             → teardown     (fora do provisioning)
```

Com:

- `graceEndsAt = endTime + graceMinutes`
- `sftpEndsAt = endTime + graceMinutes + postSftpMinutes`

**Reserva `finished` (POST `/allocations/:id/finish` — finalização antecipada):**

- **Sem grace nem SFTP com chave:** bash encerra no `endTime` real; `sftpEndsAt = endTime`.
- `graceEndsAt = endTime`
- Depois: `no_key` até `endTime + 7 dias`, então `teardown`.

**Fora da janela:** `none` (ex.: reserva futura além de T-N, ou após teardown).

### Mapa fase → ordem no `provisioning`

| Fase | `accessState` | Chave SSH | Efeito no agente |
|------|---------------|-----------|------------------|
| `prepare` | `sftp_only` | sim | `useradd` se preciso; shell SFTP; injeta `authorized_keys` |
| `active` | `full_shell` | sim | `usermod -s /bin/bash`; chave ativa |
| `grace` | `full_shell` | sim | Igual `active` (sessão “quente” para telemetria) |
| `post_sftp` | `sftp_only` | sim | `pkill -u` se vinha de bash; shell SFTP; chave mantida |
| `no_key` | `sftp_only` | revogada | `revokeSshKey` → esvazia `authorized_keys`; shell continua SFTP |
| `teardown` | — | — | Usuário **não** entra em `provisioning` |

Apenas chaves `ssh-ed25519` são aceitas no agente; demais formatos são ignorados na escrita.

### Permissões e o que o agente **não** faz

- **Não há sudo:** o grupo `sudo` não é gerenciado; acesso é **shell** (bash vs SFTP), não privilégio root.
- **Conta POSIX:** prefixo `lab.` + `systemUsername` do usuário no banco; grupo `lab`; home `700`, `.ssh` `700`, `authorized_keys` `600`.
- **Senha:** o agente nunca define senha de login — só chave pública.
- **Bloqueio global:** `accessControl.shouldBlock` permanece `false`; o bloqueio é por `accessState` e revogação de chave.

### Criação e manutenção de usuário no Linux

1. **Primeira necessidade** (fase `prepare` ou posterior): API inclui o usuário em `provisioning` → agente `useradd -m -s /bin/bash -G lab` (shell inicial bash; política ajusta em seguida).
2. **Chave:** escrita em `/home/lab.<user>/.ssh/authorized_keys` se mudou ou se ainda não existia.
3. **Shell:** `usermod -s` para `/bin/bash` ou `SFTP_SHELL` conforme `accessState`.
4. **Transição bash → SFTP:** se o último estado foi `full_shell` e a ordem passa a `sftp_only`, o agente roda **`pkill -u`** antes do `usermod -s` (encerra sessões e processos órfãos).
5. **Inventário API:** `machine_users` é atualizado no heartbeat (`updateOrCreate`); `lastActiveAt` só em `full_shell`.

### Finalização de sessão

| Evento | Quem | Efeito no ciclo |
|--------|------|-----------------|
| Relógio atinge `endTime` (`approved`) | Tempo | API passa `active` → `grace` → `post_sftp` → `no_key` → `teardown` |
| POST `finish` | Usuário/admin | `status = finished`, `endTime = now`; pula grace; entra direto em SFTP com chave |
| POST `extend` | Usuário (no grace) | Aumenta `endTime`; prolonga bash e adia fases seguintes |
| `pkill` no agente | Heartbeat | Ao sair de `full_shell` para `sftp_only` (fim natural ou pós-grace) |

O front pode exibir `currentAllocation.phase`, `graceEndsAt` e `sftpEndsAt` retornados no heartbeat quando a máquina está em fase quente.

### SFTP pós-reserva

- **Objetivo:** permitir copiar artefatos da home após o bash, sem terminal interativo.
- **Com chave (`post_sftp`):** mesmo usuário `lab.*`, shell restrito a SFTP, `authorized_keys` válido.
- **Sem chave (`no_key`):** shell ainda SFTP, mas `revokeSshKey: true` — login por chave deixa de funcionar; conta POSIX pode permanecer até o teardown.

Duração padrão da janela com chave: **24 h** (`postSftpMinutes = 1440`), somada ao grace em reservas `approved`.

### Remoção de usuário (`userdel`)

Dois mecanismos complementares:

1. **Drift (agente):** após cada heartbeat, o agente remove do SO todo `lab.*` que **não** apareceu em `provisioning` na resposta (FASE 1 de `apply_provisioning`: `pkill -u`, `userdel -r -f`). `provisioning: []` ainda executa essa limpeza.
2. **Inventário (API):** se o SO não lista mais o usuário em `provisionedOsUsers` e a API não precisa dele (`phasesByUserId` vazio), a linha em `machine_users` é apagada.

A remoção física ocorre quando a fase vira **`teardown`**: `now >= endTime + LAB_ALLOCATION_DELETE_USER_DAYS` para aquela alocação. Até lá, fases `post_sftp` / `no_key` ainda mantêm o usuário na lista de provisionamento (sem bash útil após revogação).

### Várias alocações do mesmo usuário na mesma máquina

O heartbeat escolhe **uma fase dominante por `userId`** (maior “rank”: `active`/`grace` > `prepare`/`post_sftp` > `no_key`). Ex.: reserva nova em `prepare` enquanto uma antiga `finished` ainda está em `no_key` → a nova fase prevalece e o usuário volta a ter chave/bash conforme a reserva nova.

### Countdown de 7 dias — reserva nova antes do fim?

**Não há “reset” de um único timer global.** Cada alocação define seu próprio marco:

```text
deleteUserAt = allocation.endTime + deleteUserDays   (padrão: +7 dias)
```

- A alocação **antiga**, ao atingir `endTime + 7d`, entra em `teardown` e **deixa de pedir** provisionamento por aquela reserva.
- Se o mesmo usuário tiver uma **reserva nova** ainda em `prepare` / `active` / `grace` / `post_sftp` / `no_key`, ele **continua** em `provisioning` por causa da alocação nova → o agente **não** remove a conta no drift.
- Quando a reserva nova terminar, o prazo de remoção passa a ser **`endTime` da nova reserva + 7 dias**, independentemente do prazo que a reserva antiga já teria cumprido.

Ou seja: uma reserva subsequente **não reinicia** o relógio da reserva anterior; ela **impede a exclusão** enquanto durar e estabelece um **novo** `endTime + 7d` quando for a única (ou dominante) ainda relevante.

### Diagrama resumido (reserva `approved`, padrões 5 / 10 / 1440 / 7)

```text
        prepare   active      grace      post_sftp        no_key          teardown
          │────────│──────────│──────────│────────────────│───────────────│
T-5m      │  SFTP  │   BASH   │   BASH   │  SFTP+chave    │ SFTP sem chave │ (fora do
          │ +chave │  +chave  │  +chave  │                │                │  provisioning)
          ▼        ▼          ▼          ▼                ▼                ▼
      startTime  endTime   +10min    +24h após grace   até end+7d      ≥ end+7d
```

### Telemetria ligada à alocação

- Com fase `active` ou `grace`, a API marca a máquina como “ocupada” para preset de telemetria e preenche `currentAllocation`.
- POST `/agent/telemetry` persiste amostras no banco só se houver alocação `approved` no instante da coleta; sem alocação, só atualiza buffer realtime no dashboard.

### Gap entre reservas (contexto API)

`LAB_ALLOCATION_GRACE_MINUTES` define também o espaço mínimo entre reservas no calendário; o agente não implementa gap — só obedece ao `provisioning` atual.
