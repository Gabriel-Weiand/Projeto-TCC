# Agente de Monitoramento — Sistema de Laboratórios

Agente Python instalado em cada computador do laboratório. Responsável por:

- **Heartbeat** — polling periódico (30 s) para verificar estado da máquina e alocações
- **Telemetria** — coleta e envio de métricas de hardware (CPU, GPU, RAM, disco, rede) a cada 5 s
- **Sincronização de specs** — envia modelo de CPU/GPU, RAM total e disco ao servidor na inicialização
- **Bloqueio de tela** — bloqueia a sessão quando não há alocação válida
- **Login de usuário** — interface gráfica para validação de credenciais contra o servidor

---

## Requisitos

| Componente          | Versão mínima                        |
| ------------------- | ------------------------------------ |
| Python              | 3.10+                                |
| Sistema operacional | Ubuntu 22.04+ (ou Linux com systemd) |
| pip                 | 22+                                  |

Dependências Python (instaladas via `pip`):

- `requests` — comunicação HTTP com a API
- `psutil` — coleta de métricas de hardware
- `python-dotenv` — carregamento de variáveis de ambiente
- `customtkinter` — interface gráfica do login (tema escuro)

Opcional:

- `pynvml` — métricas de GPU NVIDIA (se indisponível, GPU reporta zero)

---

## Instalação

```bash
cd apps/agent

# Cria ambiente virtual
python3 -m venv venv
source venv/bin/activate

# Instala dependências
pip install -r requirements.txt

# (Opcional) Para métricas de GPU NVIDIA:
pip install pynvml
```

---

## Configuração

Copie o arquivo de exemplo e edite com os dados da sua máquina:

```bash
cp .env.example .env
nano .env
```

Variáveis obrigatórias:

| Variável        | Descrição                                                     |
| --------------- | ------------------------------------------------------------- |
| `SERVER_URL`    | URL completa do servidor API (ex: `http://192.168.1.10:3333`) |
| `MACHINE_TOKEN` | Token de acesso da máquina (gerado ao registrar no servidor)  |

Variáveis opcionais:

| Variável             | Padrão | Descrição                                              |
| -------------------- | ------ | ------------------------------------------------------ |
| `MAC_ADDRESS`        | (auto) | Detectado automaticamente; defina se a detecção falhar |
| `HEARTBEAT_INTERVAL` | `30`   | Intervalo do heartbeat em segundos                     |
| `TELEMETRY_INTERVAL` | `5`    | Intervalo de envio de telemetria em segundos           |

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

### Modo principal — Daemon (heartbeat + telemetria)

```bash
cd apps/agent
source venv/bin/activate

python main.py
```

O agente:

1. Valida a configuração (token e MAC)
2. Sincroniza specs de hardware com o servidor
3. Inicia o loop de heartbeat (a cada 30 s)
4. Envia telemetria (a cada 5 s) quando há alocação ativa
5. Bloqueia a tela se o servidor solicitar

Pressione `Ctrl+C` para encerrar.

### Modo login — Janela de validação de usuário

```bash
python main.py --login
```

Abre uma janela gráfica (tema escuro) onde o usuário insere email e senha. O agente valida as credenciais com o servidor e, se autorizado, reporta o login.

### Modo sync — Apenas sincronizar specs

```bash
python main.py --sync
```

Detecta e envia as especificações de hardware ao servidor, depois encerra.

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
   cp .env.example .env

   # Edite o .env:
   #   SERVER_URL=http://192.168.1.10:3333
   #   MACHINE_TOKEN=<token-copiado-do-seed>

   source venv/bin/activate
   python main.py
   ```

3. **Verificar comunicação:**
   - O terminal do agente deve mostrar `Heartbeat OK | PC-LAB-XX [available]`
   - No servidor, logs mostram as requisições chegando

4. **Testar login:**
   ```bash
   python main.py --login
   # Insira: gabriel.santos@ufpel.edu.br / aluno123
   ```

### Cenário: mesma máquina (desenvolvimento)

Use `SERVER_URL=http://localhost:3333` no `.env`. Para simular um MAC cadastrado no seed, defina `MAC_ADDRESS=AA:BB:CC:DD:01:01` (MAC do PC-LAB-01).

---

## Estrutura de arquivos

```
apps/agent/
├── main.py             # Ponto de entrada (--login / --sync / daemon)
├── agent.py            # Orquestrador: heartbeat + telemetria + bloqueio
├── api_client.py       # Cliente HTTP para /api/agent/*
├── config.py           # Carrega .env e auto-detecta MAC
├── hardware.py         # Coleta de métricas (psutil + pynvml)
├── screen_lock.py      # Bloqueio de tela (loginctl / gnome-screensaver)
├── login_window.py     # GUI de login (customtkinter, tema escuro)
├── requirements.txt    # Dependências Python
├── .env.example        # Modelo de configuração
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

| Método | Rota                       | Descrição                     |
| ------ | -------------------------- | ----------------------------- |
| POST   | `/api/agent/heartbeat`     | Polling periódico do estado   |
| POST   | `/api/agent/validate-user` | Valida credenciais do usuário |
| POST   | `/api/agent/telemetry`     | Envia métricas de hardware    |
| POST   | `/api/agent/report-login`  | Reporta login no SO           |
| POST   | `/api/agent/report-logout` | Reporta logout no SO          |
| PUT    | `/api/agent/sync-specs`    | Sincroniza specs de hardware  |

---

## Escalas de telemetria

| Métrica                 | Escala | Exemplo              |
| ----------------------- | ------ | -------------------- |
| CPU/GPU/RAM/Disco (uso) | 0–1000 | `750` = 75.0%        |
| Temperaturas            | 0–1500 | `650` = 65.0 °C      |
| Rede (download/upload)  | Mbps   | `125.5` = 125.5 Mbps |

RODAR SERVIDOR:
cd apps/agent
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Editar .env: SERVER_URL=http://localhost:3333, MACHINE_TOKEN=<do seed>, MAC_ADDRESS=AA:BB:CC:DD:01:01

python main.py
