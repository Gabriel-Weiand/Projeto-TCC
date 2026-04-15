# Agente de Servidor (HPC/Renderização)

Agente daemon para servidores de alto desempenho que gerencia:
- **Acesso SSH temporário** — Gera chaves ed25519 on-the-fly para sessões de alocação
- **Controle de recursos (cgroups v2)** — Prioriza CPU do dono da alocação via pesos
- **Telemetria** — Envia métricas de hardware (CPU, GPU, RAM, disco, rede)
- **Heartbeat** — Mantém comunicação contínua com a API

## Arquitetura

```
┌─────────────┐     HTTPS      ┌─────────────┐     SSH      ┌──────────┐
│   Frontend   │ ──────────────▶│     API      │             │ Servidor │
│   (Vue.js)   │◀── chave .pem │  (AdonisJS)  │◀───────────▶│  (Agent) │
└─────────────┘                └─────────────┘              └──────────┘
                                     │                           │
                               Aloca máquina                 Gera chave SSH
                               Valida sessão                 Instala pub key
                               Entrega privkey               Aplica cgroups
                                                             Coleta telemetria
```

## Fluxo de Acesso SSH

1. **Usuário** clica "Acessar Agora" no frontend
2. **API** valida a alocação e cria `SshSession` pendente
3. **Agente** detecta via polling (`GET /api/agent/ssh/pending`)
4. **Agente** executa `ssh-keygen -t ed25519` e instala pubkey no `authorized_keys`
5. **Agente** envia chave privada via HTTPS para a API
6. **API** repassa ao frontend → download do arquivo `.pem`
7. **Agente** deleta chave privada do disco imediatamente
8. **Ao fim da alocação**: Agente remove a pubkey do `authorized_keys`

## Controle de Recursos (cgroups v2)

Usa **pesos (weights)** ao invés de limites fixos:

| Papel          | cpu.weight | Comportamento                              |
|----------------|------------|---------------------------------------------|
| Dono (alocado) | 1000       | Prioridade máxima quando compete por CPU    |
| Convidado      | 10         | Usa 100% se sozinho, quase 0% se dono ativo|
| Sem alocação   | 100        | Padrão do Linux                             |

**Resultado**: Processos leves (SSH, bash, ls, scp) do convidado NUNCA são interrompidos.
Apenas tarefas de processamento (renderização, compilação) são despriorizadas.

## Instalação

```bash
# No servidor
sudo ./install.sh

# Configurar
sudo nano /opt/lab-server-agent/.env

# Iniciar
sudo systemctl start lab-server-agent

# Logs
journalctl -u lab-server-agent -f
```

## Execução Manual (Desenvolvimento)

```bash
# Instalar dependências
pip install -r requirements.txt

# Copiar e editar configuração
cp .env.example .env
nano .env

# Executar (requer root para cgroups/ssh)
sudo python main.py

# Modos alternativos
sudo python main.py --sync       # Apenas sincronizar specs
sudo python main.py --status     # Mostrar status
sudo python main.py --test-ssh   # Testar geração de chaves
```

## Requisitos do Servidor

- Linux com **systemd >= 244** e **cgroups v2** habilitado
- OpenSSH Server instalado
- Python 3.10+
- Execução como **root** (para gerenciar cgroups e authorized_keys)

### Verificar cgroups v2

```bash
mount | grep cgroup2
# Deve mostrar: cgroup2 on /sys/fs/cgroup type cgroup2 ...

cat /sys/fs/cgroup/cgroup.controllers
# Deve incluir: cpu
```
