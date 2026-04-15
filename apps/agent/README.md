# Agentes — Sistema de Laboratórios

O sistema possui dois agentes, cada um para um tipo diferente de máquina:

## 📁 Estrutura

```
apps/agent/
├── pc/        ← Agente para PCs de laboratório (GUI com overlay de bloqueio)
└── server/    ← Agente para servidores HPC/renderização (SSH + cgroups)
```

## `pc/` — Agente de PC (Laboratório)

Agente Python instalado em cada computador do laboratório. Responsável por:

- **Overlay de bloqueio** — tela fullscreen que bloqueia o desktop até o login
- **Login de usuário** — interface gráfica integrada para validação de credenciais
- **Alocação rápida** — permite ao aluno criar uma alocação instantânea direto do agente
- **Heartbeat** — polling periódico (30 s) para verificar estado da máquina e alocações
- **Telemetria** — coleta e envio de métricas de hardware (CPU, GPU, RAM, disco, rede) a cada 5 s
- **Sincronização de specs** — envia modelo de CPU/GPU, RAM total e disco ao servidor na inicialização

➡ Veja [pc/README.md](pc/README.md) para detalhes.

## `server/` — Agente de Servidor (HPC/Renderização)

Agente daemon para servidores de alto desempenho que gerencia:

- **Acesso SSH temporário** — Gera chaves ed25519 on-the-fly para sessões de alocação
- **Controle de recursos (cgroups v2)** — Prioriza CPU do dono da alocação via pesos
- **Telemetria** — Envia métricas de hardware (CPU, GPU, RAM, disco, rede)
- **Heartbeat** — Mantém comunicação contínua com a API

➡ Veja [server/README.md](server/README.md) para detalhes.

---

## Requisitos Comuns

| Componente          | Versão mínima                     |
| ------------------- | --------------------------------- |
| Python              | 3.10+                             |
| Sistema operacional | Ubuntu 22.04+ (Desktop com GNOME) |
| pip                 | 22+                               |

Dependências Python (instaladas via `pip`):

- `requests` — comunicação HTTP com a API
- `psutil` — coleta de métricas de hardware
- `python-dotenv` — carregamento de variáveis de ambiente
- `customtkinter` — interface gráfica do overlay e login (tema escuro)

Opcional:

- `pynvml` — métricas de GPU NVIDIA (se indisponível, GPU reporta zero)

---

## Instalação Rápida

```bash
cd apps/agent
chmod +x install.sh
./install.sh
```

O script de instalação:

1. Instala dependências do sistema (`python3-venv`, `python3-tk`)
2. Cria ambiente virtual Python e instala pacotes
3. Copia `.env.example` → `.env`
4. Configura autostart no GNOME (copia `.desktop` para `~/.config/autostart/`)
5. Imprime instruções de configuração

### Instalação Manual

```bash
cd apps/agent

# Cria ambiente virtual
python3 -m venv venv
source venv/bin/activate

# Instala dependências
pip install -r requirements.txt

# (Opcional) Para métricas de GPU NVIDIA:
pip install pynvml

# Copia configuração
cp .env.example .env
```

---

## Configuração

Edite o arquivo `.env` com os dados da sua máquina:

```bash
nano .env
```

### Variáveis obrigatórias

| Variável        | Descrição                                                    | Exemplo                     |
| --------------- | ------------------------------------------------------------ | --------------------------- |
| `SERVER_URL`    | IP do servidor API na rede local                             | `http://192.168.1.100:3333` |
| `MACHINE_TOKEN` | Token de acesso da máquina (gerado ao registrar no servidor) | (gerado pelo admin/seed)    |

### Variáveis opcionais

| Variável             | Padrão | Descrição                                              |
| -------------------- | ------ | ------------------------------------------------------ |
| `MAC_ADDRESS`        | (auto) | Detectado automaticamente; defina se a detecção falhar |
| `HEARTBEAT_INTERVAL` | `30`   | Intervalo do heartbeat em segundos                     |
| `TELEMETRY_INTERVAL` | `5`    | Intervalo de envio de telemetria em segundos           |

### Como descobrir o IP do servidor

No computador que roda a API, execute:

```bash
hostname -I | awk '{print $1}'
```

### Como obter o token da máquina

O token é gerado quando um admin cadastra a máquina. Se usou o seed:

```bash
cd apps/api
node ace db:seed
# O token é exibido no console
```

---

## Preparando o servidor (API)

> Execute estes passos **no computador que será o servidor**. O agente roda em uma máquina diferente na mesma rede.

### 1. Instalar dependências e preparar o banco

```bash
cd apps/api

npm install

# Roda as migrations (cria as tabelas no SQLite)
node ace migration:run

# Popula com dados de teste (usuários, máquinas, alocações)
node ace db:seed
```

O seed exibe os tokens de todas as máquinas cadastradas no console:

```
📟 Tokens das máquinas (salve para testes do Agent):
================================================================================
PC-LAB-01: <token-gerado-1>
PC-LAB-02: <token-gerado-2>
...
================================================================================
```

**Copie o token da máquina que deseja usar no agente.**

### 2. Iniciar o servidor

```bash
# Desenvolvimento (com hot-reload)
node ace serve --watch

# O servidor roda na porta 3333 por padrão
```

Verifique se o servidor está acessível de outra máquina:

```bash
# Do computador do agente, teste:
curl http://<IP-DO-SERVIDOR>:3333/api/alive
# Deve retornar: {"status":"ok","timestamp":"..."}
```

### 3. Usuários de teste (do seed)

| Email                         | Senha      | Papel |
| ----------------------------- | ---------- | ----- |
| `admin@lab.ufpel.edu.br`      | `admin123` | admin |
| `silva@lab.ufpel.edu.br`      | `prof1234` | admin |
| `gabriel.santos@ufpel.edu.br` | `aluno123` | user  |
| `maria.oliveira@ufpel.edu.br` | `aluno123` | user  |
| `joao.pereira@ufpel.edu.br`   | `aluno123` | user  |

---

## Executando o Agente

### Modo padrão — Overlay de bloqueio + Daemon

```bash
cd apps/agent
source venv/bin/activate

python main.py
```

O agente:

1. Valida a configuração (token e MAC)
2. Sincroniza specs de hardware com o servidor
3. **Exibe o overlay fullscreen** (tela de bloqueio com login)
4. Inicia o loop de heartbeat (a cada 30 s)
5. Quando o usuário faz login com alocação válida → esconde overlay, libera desktop
6. Envia telemetria (a cada 5 s) enquanto há alocação ativa
7. Quando a alocação termina → exibe overlay novamente

### Como encerrar o agente (fase de testes)

O overlay **NÃO** bloqueia atalhos de teclado durante a fase de testes. Para encerrar:

- **Monitor de Tarefas**: Abra `gnome-system-monitor`, encontre o processo `python` e encerre
- **Terminal**: `pkill -f 'python.*main.py'`
- **Atalho**: `Ctrl+Alt+T` abre terminal mesmo com overlay (para testes)

### Modo headless — Sem overlay (debug)

```bash
python main.py --no-gui
```

Roda apenas heartbeat + telemetria sem interface gráfica. Útil para debug.
Pressione `Ctrl+C` para encerrar.

### Modo login — Janela standalone

```bash
python main.py --login
```

Abre apenas uma janela de login (sem overlay fullscreen). Útil para testes rápidos.

### Modo sync — Apenas sincronizar specs

```bash
python main.py --sync
```

Detecta e envia as especificações de hardware ao servidor, depois encerra.

---

## Autostart no Ubuntu (GNOME)

O instalador (`install.sh`) configura o autostart automaticamente. Se precisar configurar manualmente:

```bash
# Copia o .desktop para autostart
mkdir -p ~/.config/autostart/

# Edita com os caminhos corretos
cat > ~/.config/autostart/lab-agent.desktop << EOF
[Desktop Entry]
Type=Application
Name=Lab Agent - Sistema de Laboratórios
Exec=/caminho/para/venv/bin/python /caminho/para/apps/agent/main.py
Path=/caminho/para/apps/agent
Hidden=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
Terminal=false
EOF
```

Para desabilitar temporariamente: renomeie ou delete o arquivo em `~/.config/autostart/`.

---

## Testando em rede local

### Cenário: 2 computadores na mesma rede

```
┌────────────────────┐         ┌────────────────────┐
│   PC-SERVIDOR      │         │   PC-LABORATÓRIO   │
│   (apps/api)       │◄────────│   (apps/agent)     │
│                    │  HTTP   │                    │
│   192.168.1.10     │────────►│   192.168.1.20     │
│   :3333            │         │                    │
└────────────────────┘         └────────────────────┘
```

1. **No PC-Servidor:**

   ```bash
   cd apps/api
   node ace migration:run && node ace db:seed
   node ace serve --watch
   # Anote o token da máquina desejada e o IP do servidor
   ```

2. **No PC-Laboratório:**

   ```bash
   cd apps/agent
   ./install.sh

   # Edite o .env:
   #   SERVER_URL=http://192.168.1.10:3333
   #   MACHINE_TOKEN=<token-copiado-do-seed>
   nano .env

   # Testa
   source venv/bin/activate
   python main.py
   ```

3. **Verificar comunicação:**
   - O terminal do agente deve mostrar `Heartbeat OK | PC-LAB-XX [available]`
   - O overlay fullscreen deve aparecer com a tela de login

4. **Testar login:**
   - No overlay, insira: `gabriel.santos@ufpel.edu.br` / `aluno123`
   - Se houver alocação ativa → overlay desaparece, desktop é liberado
   - Se não houver alocação → mensagem de erro + botão de Alocação Rápida

### Cenário: mesma máquina (desenvolvimento)

Use `SERVER_URL=http://localhost:3333` no `.env`. Para simular um MAC cadastrado no seed, defina `MAC_ADDRESS=AA:BB:CC:DD:01:01` (MAC do PC-LAB-01).

---

## Estrutura de arquivos

```
apps/agent/
├── main.py             # Ponto de entrada (overlay + daemon / --no-gui / --login / --sync)
├── agent.py            # Orquestrador: heartbeat + telemetria + controle do overlay
├── api_client.py       # Cliente HTTP para /api/agent/*
├── config.py           # Carrega .env e auto-detecta MAC
├── hardware.py         # Coleta de métricas (psutil + pynvml)
├── screen_lock.py      # Overlay fullscreen de bloqueio (customtkinter)
├── login_window.py     # Janela de login standalone (customtkinter)
├── requirements.txt    # Dependências Python
├── .env.example        # Modelo de configuração
├── lab-agent.desktop   # Template de autostart (XDG)
├── install.sh          # Script de instalação automatizado
└── README.md           # Este arquivo
```

---

## Comunicação com a API

Todas as rotas do agente usam o prefixo `/api/agent/` e requerem:

| Header          | Valor                                     |
| --------------- | ----------------------------------------- |
| `Authorization` | `Bearer <MACHINE_TOKEN>`                  |
| `X-Machine-Mac` | `<MAC_ADDRESS>` (ex: `AA:BB:CC:DD:01:01`) |

### Rotas utilizadas

| Método | Rota                        | Descrição                              |
| ------ | --------------------------- | -------------------------------------- |
| POST   | `/api/agent/heartbeat`      | Polling periódico do estado            |
| POST   | `/api/agent/validate-user`  | Valida credenciais do usuário          |
| GET    | `/api/agent/day-schedule`   | Retorna agenda do dia (sem nomes)      |
| POST   | `/api/agent/quick-allocate` | Cria alocação rápida                   |
| POST   | `/api/agent/report-login`   | Reporta login no SO                    |
| POST   | `/api/agent/report-logout`  | Reporta logout no SO                   |
| PUT    | `/api/agent/sync-specs`     | Sincroniza specs de hardware           |
| POST   | `/api/agent/telemetry`      | Envia métricas de hardware (batch 5 s) |

---

## Escalas de telemetria

| Métrica                 | Escala | Exemplo              |
| ----------------------- | ------ | -------------------- |
| CPU/GPU/RAM/Disco (uso) | 0–1000 | `750` = 75.0%        |
| Temperaturas            | 0–1500 | `650` = 65.0 °C      |
| Rede (download/upload)  | Mbps   | `125.5` = 125.5 Mbps |

---

## Desinstalação

```bash
cd apps/agent
chmod +x uninstall.sh
./uninstall.sh
```

O script remove:

1. Autostart do GNOME (`~/.config/autostart/lab-agent.desktop`)
2. Ambiente virtual Python (`venv/`)
3. Arquivo de configuração (`.env`)

Cada etapa pede confirmação antes de executar.
