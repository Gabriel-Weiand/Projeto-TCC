# Requisitos de Frontend — Próximas Iterações

## 1. Calendário de Agendamento (Refatoração)

### Problema atual

O `NewAllocationModal.vue` e o formulário em `MachineDetailView.vue` usam três campos separados: `date`, `startTime`, `endTime`. Isso força o usuário a:
- Selecionar a data manualmente em um campo e os horários em outros dois
- Realizar duas alocações separadas para reservar um servidor de sexta às 18h até segunda às 08h
- Lidar com a validação `startTime >= endTime` que só compara strings de hora — quebra em alocações multi-dia

O calendário atual não representa visualmente alocações que cruzam meia-noite ou que duram vários dias.

### O que deve mudar

**Seletor de período com datetime completo (não date + time separados)**

Substituir os três campos por dois seletores `datetime-local`:
- `Início` — `<input type="datetime-local">`
- `Fim` — `<input type="datetime-local">`

Isso permite alocações de qualquer duração sem restrição de horário de funcionamento. O servidor roda 24h — a reserva pode começar às 23h e terminar três dias depois.

**Calendário de disponibilidade visual (grade de semana/mês)**

A tela de detalhe da máquina deve exibir uma grade de calendário mostrando:
- Blocos coloridos para alocações existentes (aprovadas, pendentes, do usuário atual)
- Capacidade de navegar semanas/meses
- Ao clicar em um intervalo livre, preenche automaticamente os campos de início e fim

Biblioteca recomendada: **`@fullcalendar/vue3`** com as views `timeGridWeek` e `dayGridMonth`. Alternativa mais leve: **`v-calendar`**.

**Validações no frontend**

| Regra | Mensagem |
|---|---|
| `endTime <= startTime` | "O fim deve ser após o início." |
| Duração < 30 minutos | "Reservas devem ter no mínimo 30 minutos." |
| Início no passado | "Não é possível reservar no passado." |
| Sobreposição com alocação existente (verificação local antes de enviar) | "Este horário conflita com uma reserva existente." |

**Nota:** A validação definitiva de conflito ocorre na API (retorna HTTP 409) — a verificação local é apenas para UX, não substituindo a do servidor.

---

## 2. Gerenciamento de Sessões SSH (Telas Novas)

### Contexto

A API já possui:
- `GET /api/v1/ssh-sessions` — lista sessões com filtros `machineId`, `userId`, `status`
- `DELETE /api/v1/ssh-sessions/:id` — admin revoga uma sessão (agente processa em ~5s)
- `POST /api/v1/allocations/:id/ssh-access` — usuário solicita chave SSH para sua alocação ativa

### 2.1 — Fluxo do usuário: obter acesso SSH

Quando o usuário tem uma alocação ativa, a tela de detalhe da máquina deve exibir um botão **"Conectar via SSH"**. O fluxo é de polling porque o agente leva ~5s para gerar a chave:

```
Usuário clica "Conectar via SSH"
  └── POST /api/v1/allocations/:id/ssh-access
        ├── status: 'pending' → mostra spinner "Aguardando agente..."
        │     └── Repete a cada 3s até status mudar
        ├── status: 'ready'   → exibe modal com instruções de conexão
        └── status: 'expired' → exibe botão "Solicitar nova chave"
```

**Modal de conexão (quando status = 'ready'):**

A resposta da API retorna `{ privateKey, systemUsername, machineIp, expiresAt }`. O modal deve:

1. **Exibir o comando de conexão pronto para copiar:**
   ```
   ssh -i ~/Downloads/lab-key.pem alocador-joaosilva@192.168.1.10
   ```

2. **Botão "Baixar chave privada"** — gera download do arquivo `lab-key.pem` com o conteúdo de `privateKey`. O frontend deve forçar permissão 600 via instrução textual (não é possível via browser):
   > "Após baixar, execute: `chmod 600 ~/Downloads/lab-key.pem`"

3. **Aviso de expiração** — mostrar `expiresAt` formatado. A chave é de uso único: após o download, `sshKeyStore` a remove da memória. Se o usuário fechar o modal sem baixar, precisará solicitar novamente.

4. **Instruções para Windows** — alternativa com PuTTY/WinSCP usando a chave baixada.

**A chave privada nunca é armazenada no banco** — existe apenas em memória na API por até 5 minutos. O frontend não deve cachear a chave.

### 2.2 — Nome de usuário no servidor

O `systemUsername` retornado pela API segue o formato:

```
alocador-{nome_sem_espaços_minúsculas}
```

Onde `nome_sem_espaços_minúsculas` é derivado de `user.fullName`:
- Converter para minúsculas
- Substituir espaços por hífens
- Remover caracteres especiais (acentos, pontuação)
- Truncar em 32 caracteres (limite do Linux para usernames)

Exemplos:
| Nome completo | systemUsername |
|---|---|
| João Silva | `alocador-joao-silva` |
| Maria Fernanda Oliveira | `alocador-maria-fernanda-oliveira` |
| Carlos D'Ávila | `alocador-carlos-davila` |

**Este username é criado pelo admin ao cadastrar a máquina** (campo `systemUsername` em `Machine`). O agente usa esse username para instalar a chave no `authorized_keys` do usuário correto. O frontend deve exibir o `systemUsername` na tela de detalhes da máquina (admin) e no modal de conexão SSH (usuário).

**Nota para o admin:** o usuário Unix `alocador-*` deve existir no servidor antes de qualquer alocação. O `install.sh` do agente deve criar esses usuários com `useradd --create-home --shell /bin/bash alocador-joao-silva`.

### 2.3 — Tela admin: gerenciamento de sessões SSH

**Localização:** nova aba "Sessões SSH" em `AdminMachineDetailView.vue` ou página dedicada `AdminSshSessionsView.vue`.

**Tabela de sessões ativas:**

| Coluna | Descrição |
|---|---|
| Usuário | `user.fullName` |
| Usuário do sistema | `systemUsername` |
| Fingerprint | Últimos 16 chars de `publicKeyFingerprint` |
| Aberta em | `createdAt` formatado |
| Expira em | `expiresAt` com countdown |
| Status | Badge: `active` / `revoked` / `expired` |
| Ação | Botão "Revogar" (somente status `active`) |

**Ao clicar "Revogar":**
- Chama `DELETE /api/v1/ssh-sessions/:id`
- Exibe confirmação: "O agente irá remover o acesso em até 5 segundos."
- Atualiza a linha para status `revoked` otimisticamente

**Filtros:** por máquina, por status (active/revoked/expired), por usuário.

---

## 3. Telemetria — Adaptação das Métricas

### Estado atual

O tipo `RealtimeTelemetry` no frontend tem:
```typescript
{ cpuUsage, cpuTemp, gpuUsage, gpuTemp, ramUsage, diskUsage,
  moboTemperature, downloadUsage, uploadUsage, timestamp }
```

O agente novo vai enviar métricas enriquecidas. O frontend precisa absorver os campos novos **sem quebrar** quando eles estiverem ausentes (servidores sem GPU, por exemplo).

### Campos novos a adicionar ao tipo

```typescript
export interface RealtimeTelemetry {
  // Existentes (sem mudança)
  cpuUsage: number          // 0–100 (%)
  cpuTemp: number           // °C
  gpuUsage: number          // 0–100 (%)
  gpuTemp: number           // °C
  ramUsage: number          // 0–100 (%)
  diskUsage: number | null  // 0–100 (%)
  downloadUsage: number | null  // Mbps
  uploadUsage: number | null    // Mbps
  moboTemperature: number | null // °C
  timestamp: string

  // Novos — todos opcionais (null se não disponível)
  cpuFreqMhz: number | null       // frequência atual da CPU em MHz
  vramUsage: number | null        // 0–100 (% de VRAM usada)
  gpuPowerWatts: number | null    // consumo da GPU em Watts
  gpuFanSpeed: number | null      // 0–100 (% velocidade do fan da GPU)
  cpuFanSpeed: number | null      // 0–100 (% velocidade do fan da CPU)
  swapUsage: number | null        // 0–100 (% de swap usada)
  diskReadKbps: number | null     // leitura de disco em KB/s
  diskWriteKbps: number | null    // escrita de disco em KB/s
  topProcesses: ProcessInfo[] | null    // top 10 processos por CPU
  gpuProcesses: GpuProcessInfo[] | null // processos usando a GPU
}

export interface ProcessInfo {
  pid: number
  name: string
  cpuPercent: number   // 0–100
  memPercent: number   // 0–100
  username: string
}

export interface GpuProcessInfo {
  pid: number
  name: string
  vramMb: number
  username: string
}
```

### O que mostrar na UI

**Dashboard de máquina (cards de métricas):**

| Métrica | Exibição | Presente em |
|---|---|---|
| CPU Usage + Temp | Gauge + badge °C | Sempre |
| CPU Freq | Badge "X GHz" | Se `cpuFreqMhz != null` |
| RAM Usage + Swap | Barra dupla | RAM sempre; Swap se disponível |
| GPU Usage + Temp | Gauge + badge °C | Se GPU presente |
| VRAM Usage | Barra | Se `vramUsage != null` |
| GPU Power | Badge "X W" | Se `gpuPowerWatts != null` |
| Disk R/W | Par de badges KB/s | Se `diskReadKbps != null` |
| Rede Up/Down | Par de badges Mbps | Se disponível |
| Top Processos | Tabela compacta (5 linhas) | Se `topProcesses != null` |
| Processos GPU | Tabela compacta | Se `gpuProcesses != null` |

**Regra de exibição:** nunca mostrar um card/badge com valor `null`. Usar `v-if="telemetry.gpuUsage !== null"` — não mostrar "GPU: —".

**Gráficos históricos (tela de detalhe):**

Os gráficos existentes plotam CPU/GPU/RAM ao longo do tempo de uma alocação. Os novos campos de processo (`topProcesses`, `gpuProcesses`) não devem ser plotados em gráfico — são dados instantâneos, adequados apenas para exibição tabular em tempo real.

---

## 4. Impacto na API — Campos a adicionar

Estas mudanças no frontend dependem de campos que ainda não existem na API ou nos tipos compartilhados:

| Campo | Onde adicionar | Prioridade |
|---|---|---|
| `systemUsername` visível em `Machine` | Já existe no modelo, verificar se o serializer expõe | Alta |
| `SshSession` como tipo TypeScript | Criar `src/types/index.ts` | Alta |
| Campos novos de telemetria | `RealtimeTelemetry` em `types/index.ts` | Média |
| `connectedUsers: string[]` em `Machine` | Para exibir quem está conectado no dashboard admin | Média |

---

## 5. Ordem de implementação sugerida

1. **Tipo `SshSession`** + serviço `ssh-sessions.ts` (GET e DELETE) — base para tudo de SSH
2. **Modal de conexão SSH** no `MachineDetailView.vue` — visível ao usuário com alocação ativa
3. **Tela admin de sessões SSH** — gerenciamento e revogação
4. **Seletor `datetime-local`** no modal de nova reserva — substitui os três campos atuais
5. **Calendário visual** de disponibilidade — depende do seletor estar pronto
6. **Tipos de telemetria expandidos** — adicionar campos opcionais sem quebrar o que existe
7. **Cards de métricas novas** — VRAM, power, processos, disco R/W
