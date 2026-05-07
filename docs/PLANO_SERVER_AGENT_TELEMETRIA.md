# Plano: Server Agent + API Telemetria Enriquecida

## Contexto
- Sem containers por enquanto (LXD adiado para o futuro)
- SSH bare-metal (fluxo existente mantido, polir)
- Agente roda como serviço root no servidor (systemd)
- psutil + nvidia-ml-py (importado como pynvml) para telemetria
- cgroups v2 via systemd slices (já implementado, extender com Mem + IO)
- ACL para diretório compartilhado ~/shared/ (novo)

## Decisões
- Telemetria persiste no DB apenas durante alocações ativas (comportamento atual)
- Top 10 processos (configurável) gravados como JSON no campo `top_processes`
- GPU processes (nvidia-ml-py) gravados no mesmo campo JSON
- Background users: cgroups v2 (CPU+Mem+IO) + ACL ~/shared/
- GPU sem isolamento por enquanto
- `loggedUserName` na telemetria = system_username da alocação ativa, não getpass.getuser()
- Escalamento ×10 inteiro: VÁLIDO e mais eficiente. INTEGER = 2 bytes vs REAL = 8 bytes no SQLite. Manter.
- Persistência de telemetria: 1 linha por MINUTO (média de 12 leituras de 5s) em vez de linhas brutas. Redução 12×. Real-time buffer em memória mantém resolução de 5s.
- `allocation_metrics`: manter `table.float()` para avg/max — correto para médias de inteiros escalados.
- Sem novas migration files: editar as migrations existentes diretamente + `node ace migration:fresh`

---

## FASE 1 — Agente do Servidor (apps/agent/server/)

### Módulos a reescrever/criar do zero:
- config.py → atualizar
- hardware.py → reescrever completamente
- resource_manager.py → novo (substitui cgroup_manager.py)
- api_client.py → atualizar payload
- agent.py → atualizar orquestrador
- requirements.txt → atualizar (pynvml → nvidia-ml-py)

### Módulos a manter:
- ssh_manager.py → manter (funciona bem)
- main.py → ajustes menores (novo nome do resource_manager)
- install.sh → adicionar `apt-get install -y acl` e criar grupo lab-users

---

### 1.1 config.py
Novos valores:
- TOP_PROCESSES_COUNT = 10
- CGROUP_OWNER_MEMORY_MAX = "85%"
- CGROUP_GUEST_MEMORY_MAX = "20%"
- CGROUP_OWNER_IO_WEIGHT = 1000
- CGROUP_GUEST_IO_WEIGHT = 10
- LAB_GROUP = "lab-users"  # grupo Unix para ACL compartilhado
- SHARED_DIR_NAME = "shared"

---

### 1.2 hardware.py — reescrever

**Dependências**: psutil, nvidia-ml-py (import pynvml), subprocess, glob, socket, time

**Tracker classes**:
- `_NetworkTracker` — já existe, manter
- `_DiskIOTracker` — novo: delta de psutil.disk_io_counters() → (read_kbps, write_kbps)

**Novos coletores**:
- `get_cpu_freq_mhz()` → psutil.cpu_freq().current (int MHz)
- `get_vram_usage()` → nvmlDeviceGetMemoryInfo: used/total * 1000 (int 0-1000)
- `get_gpu_power_watts()` → nvmlDeviceGetPowerUsage() / 1000 (watts inteiro)
- `get_gpu_fan_speed()` → nvmlDeviceGetFanSpeed() * 10 (int 0-1000)
- `get_cpu_fan_speed()` → psutil.sensors_fans(): encontrar entrada correta → int 0-1000
- `get_disk_io_kbps()` → _DiskIOTracker.get() → (read_kbps, write_kbps)
- `get_swap_usage()` → psutil.swap_memory().percent * 10 (int 0-1000)
- `get_top_processes(n=10)` → psutil.process_iter(['pid','name','cpu_percent','memory_percent'])
  - Sort by cpu_percent, return top n as list of dicts
  - Handle ZombieProcess / NoSuchProcess exceptions
- `get_gpu_compute_processes()` → nvmlDeviceGetComputeRunningProcesses() → [{pid, vramMb, name}]

**`collect_telemetry()` retorna**:
```json
{
  "cpuUsage": 650,          // 0-1000
  "cpuTemp": 720,           // 0-1500
  "cpuFreqMhz": 4200,       // MHz inteiro
  "gpuUsage": 200,          // 0-1000
  "gpuTemp": 550,           // 0-1500
  "gpuPowerWatts": 180,     // watts direto
  "vramUsage": 300,         // 0-1000
  "gpuFanSpeed": 500,       // 0-1000 (nullable)
  "ramUsage": 480,          // 0-1000
  "swapUsage": 50,          // 0-1000 (nullable)
  "diskUsage": 300,         // 0-1000
  "diskReadKbps": 15000,    // KB/s inteiro (nullable)
  "diskWriteKbps": 8000,    // KB/s inteiro (nullable)
  "downloadUsage": 45.0,    // Mbps float
  "uploadUsage": 10.0,      // Mbps float
  "cpuFanSpeed": 450,       // 0-1000 (nullable)
  "moboTemperature": 400,   // 0-1500 (nullable)
  "loggedUserName": "john", // system_username da alocação ativa
  "topProcesses": [...],    // top 10 por CPU [{pid,name,cpuPercent,memPercent}]
  "gpuProcesses": [...]     // [{pid,name,vramMb}] (nullable)
}
```

**`get_system_specs()` adicionar**:
- `totalVramGb` → nvmlDeviceGetMemoryInfo().total / (1024^3) arredondado

---

### 1.3 resource_manager.py — novo (substitui cgroup_manager.py)

**Extende a lógica existente de CPUWeight com**:
- `_set_memory_max(uid, value_pct)` → `systemctl set-property user-<uid>.slice MemoryMax=<value>`
- `_set_io_weight(uid, weight)` → `systemctl set-property user-<uid>.slice IOWeight=<weight>`
- Fallback sysfs para memory: escrever em `/sys/fs/cgroup/user.slice/user-<uid>.slice/memory.max`
- Fallback sysfs para io: escrever em `/sys/fs/cgroup/user.slice/user-<uid>.slice/io.weight`

**Atualizar métodos**:
- `set_owner(username)` → CPUWeight=1000, MemoryMax=OWNER_MEMORY_MAX, IOWeight=1000
- `set_guest(username)` → CPUWeight=10, MemoryMax=GUEST_MEMORY_MAX, IOWeight=10
- `reset_all()` → reset CPU + remover MemoryMax (MemoryMax=infinity) + IOWeight=100 para todos

**Novos métodos**:
- `setup_shared_directory(owner_username)`:
  - Cria `/home/<owner>/shared/` se não existir (chown ao owner)
  - `setfacl -m g:lab-users:rx /home/<owner>/shared/`
  - `setfacl -d -m g:lab-users:rx /home/<owner>/shared/` (herança)
  - Log sucesso/falha
- `teardown_shared_directory(owner_username)`:
  - `setfacl -x g:lab-users /home/<owner>/shared/` (remove ACL do grupo)
  - `setfacl -x d:g:lab-users /home/<owner>/shared/` (remove default ACL)
  - Não deleta o diretório (owner mantém arquivos)
- `ensure_lab_group()`:
  - Verifica se grupo `lab-users` existe (via grp.getgrnam)
  - Se não existir, cria com `groupadd lab-users`
  - Chamado no `__init__` ou na inicialização do agente

---

### 1.4 api_client.py — atualizar payload de telemetria

Apenas atualizar a assinatura do método `send_telemetry(data: dict)` para aceitar o novo dict maior.
Sem mudanças estruturais de endpoints.

---

### 1.5 agent.py — atualizar

- Import `ResourceManager` ao invés de `CGroupManager`
- `_apply_cgroup_for_allocation(allocation)`:
  - Chamar `resource_manager.set_owner(system_username)`
  - Chamar `resource_manager.setup_shared_directory(system_username)`
- `_handle_allocation_ended()`:
  - Chamar `resource_manager.reset_all()`
  - Chamar `resource_manager.teardown_shared_directory(owner_username)` (guardar username antes de limpar)
- `_send_telemetry()`:
  - Passar `current_allocation_username` para `collect_telemetry()` como `loggedUserName`
  - Ou: hardware.py expõe um setter `set_active_user(username)` e coleta usa o valor atual
- `start()`:
  - Chamar `resource_manager.ensure_lab_group()` na inicialização

---

### 1.6 requirements.txt
```
requests>=2.31.0
psutil>=6.0.0
nvidia-ml-py>=12.0.0
python-dotenv>=1.0.0
```
(remover pynvml — era o pacote depreciado)

---

### 1.7 install.sh
Adicionar:
- `apt-get install -y acl` antes de instalar requirements
- `groupadd -f lab-users` (cria o grupo se não existir, -f não falha se já existe)

---

## FASE 2 — API (apps/api/)

### Sem novas migration files — editar as existentes diretamente + `node ace migration:fresh`

### 2.1 Editar `1769304812581_create_telemetries_table.ts`
Adicionar dentro do `createTable` existente:
- `table.timestamp('sampled_at').notNullable()` — timestamp do fim da janela de 60s (essencial para timeline/graficos)
- `table.integer('cpu_freq_mhz').unsigned().nullable()`
- `table.integer('vram_usage').unsigned().nullable()` — 0-1000
- `table.integer('gpu_power_watts').unsigned().nullable()` — watts direto
- `table.integer('disk_read_kbps').unsigned().nullable()`
- `table.integer('disk_write_kbps').unsigned().nullable()`
- `table.integer('swap_usage').unsigned().nullable()` — 0-1000
- `table.integer('cpu_fan_speed').unsigned().nullable()` — 0-1000
- `table.integer('gpu_fan_speed').unsigned().nullable()` — 0-1000
- `table.text('top_processes').nullable()` — JSON, último snapshot da janela de 60s

### 2.2 Editar `1769307988100_create_allocation_metrics_table.ts`
Adicionar ao `createTable` (mantém `table.float()` existente — correto para médias):
- `table.float('avg_vram_usage').nullable()`
- `table.float('max_vram_usage').nullable()`
- `table.float('avg_gpu_power_watts').nullable()`
- `table.float('max_gpu_power_watts').nullable()`

### 2.3 Editar `1769302329499_create_machines_table.ts`
Adicionar:
- `table.integer('total_vram_gb').unsigned().nullable()`

### 2.4 Recriar banco
`node ace migration:fresh` no diretório `apps/api/`

### 2.5 Model: app/models/telemetry.ts
Adicionar todos os novos `@column()` com `columnName` explícito (camelCase → snake_case)
Adicionar `@column.dateTime() declare sampledAt: DateTime`

### 2.6 Model: app/models/allocation_metric.ts
Adicionar `@column() declare avgVramUsage: number | null`, etc.

### 2.7 Model: app/models/machine.ts
Adicionar `@column() declare totalVramGb: number | null`

### 2.8 Validator: app/validators/telemetry.ts
Adicionar campos opcionais com `vine.number().optional()`:
- cpuFreqMhz, vramUsage, gpuPowerWatts, diskReadKbps, diskWriteKbps
- swapUsage, cpuFanSpeed, gpuFanSpeed
- topProcesses → `vine.string().optional()` (JSON serializado pelo agente)

### 2.9 Service: app/services/telemetry_buffer.ts — mudança estrutural

Adicionar `_aggregationAccumulator: Map<number, { readings: TelemetryData[], lastRaw: TelemetryData }>`.

Mudar `add(machineId, data)`:
- Continua chamando `updateRealtime()` normalmente (sem mudança no SSE)
- Em vez de `this.buffer.push(data)`: adiciona ao acumulador por `data.allocationId`

Mudar `flush()`:
- Para cada allocationId no acumulador:
  - Calcular avg de cada campo numérico sobre as `readings` acumuladas
  - `top_processes`: usar `lastRaw.topProcesses`
  - `sampled_at`: `new Date()` (fim da janela)
  - `loggedUserName`: `lastRaw.loggedUserName`
  - Empurrar 1 linha para `toInsert`
  - Limpar acumulador desse allocationId
- `Telemetry.createMany(toInsert)` — igual ao hoje, mas com 1 linha por allocationId por flush

Atualizar interface `TelemetryData` com todos os novos campos

### 2.10 Controller: app/controllers/agent_controller.ts
Atualizar `telemetry()` para receber e repassar novos campos ao buffer

### 2.11 Controller: app/controllers/machines_controller.ts
Incluir novos campos nas respostas de `telemetry` e `telemetryStream`

### 2.12 Service: app/services/allocation_summarizer.ts
Atualizar `calculateMetrics()` para calcular avg/max de vramUsage e gpuPowerWatts

### 2.13 Controller: app/controllers/allocations_controller.ts
Retornar novos campos do `AllocationMetric` em `getSessionSummary`

---

## Arquivos Relevantes

### Agente (apps/agent/server/)
- `config.py` — adicionar novos configs
- `hardware.py` — reescrever: psutil + nvidia-ml-py, trackers, novos coletores
- `resource_manager.py` — novo: CPU+Mem+IO cgroups + shared dir ACL
- `agent.py` — atualizar: resource_manager, shared dir lifecycle, logged user tracking
- `api_client.py` — atualizar payload telemetria
- `requirements.txt` — nvidia-ml-py ao invés de pynvml
- `install.sh` — apt acl + groupadd lab-users

### API (apps/api/)
- `database/migrations/` — editar 3 migrations existentes
- `app/models/telemetry.ts` — novos campos
- `app/models/allocation_metric.ts` — novos campos GPU
- `app/models/machine.ts` — totalVramGb
- `app/validators/telemetry.ts` — novos campos opcionais
- `app/services/telemetry_buffer.ts` — agregação por minuto
- `app/controllers/agent_controller.ts` — telemetry handler
- `app/controllers/machines_controller.ts` — telemetry response
- `app/controllers/allocations_controller.ts` — summary response
- `start/routes.ts` — sem mudanças (rotas existentes são suficientes)

---

## Verificação

1. Testar `hardware.py` standalone: `python3 -c "from hardware import collect_telemetry; print(collect_telemetry())"`
2. Testar resource_manager: verificar CPUWeight via `systemctl show user-<uid>.slice | grep CPU`
3. Testar ACL: verificar com `getfacl /home/<user>/shared/`
4. Recriar banco: `node ace migration:fresh` sem erros
5. Testar endpoint telemetria: `POST /api/agent/telemetry` com payload completo → HTTP 200
6. Testar stream: abrir `GET /api/v1/machines/:id/telemetry/stream` → SSE com novos campos
7. Testar SSH flow: requestSshAccess → polling → key setup → connect → teardown
8. Verificar systemd service: `systemctl status lab-server-agent`
