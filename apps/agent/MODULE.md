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

Executada **apenas uma vez** quando o `agentd.py` inicia.

- **O que faz:** Lê informações físicas e fixas — Modelo da CPU, Modelo da GPU, Total de RAM e Partições de Disco.
- **Por que existe:** Garante que a base de dados do laboratório reflete a realidade do hardware atual, mesmo que a máquina tenha recebido um upgrade de memória.

### 2. `POST /api/v1/agent/heartbeat` (Comando e Controle)

Executada em ciclo contínuo a cada **30 segundos** (intervalo fixo, não alterável).

- **O que envia (Agente → API):**
  - `connectedUsers`: Lista de quem está logado ativamente via TTY ou SSH.
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
      "accessState": "sftp_only",
      "isSudo": false
    },
    {
      "systemUsername": "lab.gabriel_weiand",
      "sshPublicKey": "ssh-ed25519 AAAAC3...",
      "accessState": "full_shell",
      "isSudo": true
    }
  ]
}
```

- `sftp_only`: Modo Preparação T-5 minutos ou bloqueio fora do horário.
- `full_shell`: Alocação ativa — acesso total ao terminal SSH (Bash).

### Ação do Agente com a Resposta

1. **Configuração Dinâmica:** Ajusta o intervalo da Thread de Telemetria com base no `agentConfig`.
2. **Reconciliação (Drift):** Se a API não listou um usuário que estava em `provisionedOsUsers`, o agente roda `userdel` e `pkill` nele.
3. **Execução de Políticas:** Para cada item em `provisioning`, o agente garante que:
   - A conta existe e a chave SSH bate com o arquivo local.
   - Se `accessState == sftp_only`, o shell do usuário no `/etc/passwd` é alterado para SFTP.
   - Se `accessState == full_shell`, o shell é alterado para `/bin/bash`.
   - Se `isSudo == true`, coloca no grupo sudo/wheel; caso contrário, remove.

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
