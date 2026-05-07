# Arquitetura do Agente Python — Análise e Adequação ao Projeto

## O que é o agente e o que ele precisa fazer

O agente é um **daemon Linux com privilégios root** que roda permanentemente em cada servidor do laboratório. Suas responsabilidades são:

1. **Reportar estado** — enviar telemetria de hardware para a API central a cada 5s
2. **Executar ordens** — receber instruções da API (via polling) e atuar no sistema operacional
3. **Gerenciar acesso SSH** — provisionar e revogar chaves temporárias para usuários alocados
4. **Controlar recursos** — aplicar cgroups v2 para garantir prioridade ao usuário dono da alocação

O agente **não tem interface de usuário** e **não aceita conexões de entrada** — toda comunicação é de saída (agente → API), exceto o SSH gerenciado no próprio host.

---

## Estrutura atual dos módulos

```
apps/agent/server/
├── main.py            # Entrypoint: valida env, escolhe modo de operação
├── agent.py           # Orquestrador: spawna threads, reage a alocações
├── config.py          # Carrega .env, expõe constantes tipadas
├── hardware.py        # Coleta de métricas (psutil + pynvml)
├── api_client.py      # HTTP client com autenticação de máquina
├── cgroup_manager.py  # Controle de CPU via cgroups v2/systemd
├── ssh_manager.py     # Geração e revogação de chaves SSH ed25519
├── install.sh         # Instala como serviço systemd em /opt/
└── requirements.txt
```

### Fluxo de execução

```
main.py
  └── ServerAgent.start()
        ├── thread: _do_heartbeat()      → POST /api/agent/heartbeat (5s)
        │     ├── lê `who -q` → connectedUsers: ['aluno.silva', ...]
        │     └── ao detectar alocação → _apply_cgroup_for_allocation()
        │                                → ssh_manager provisionado via polling
        ├── thread: _send_telemetry()    → POST /api/agent/telemetry (5s)
        └── thread: _process_ssh_requests() → GET /api/agent/ssh/pending (5s)
                                             → POST /api/agent/ssh/setup
```

Cada módulo tem responsabilidade única e bem delimitada. Nenhum módulo importa outro exceto pelo `agent.py` (orquestrador) e `main.py` (entrypoint) — o que torna o código testável individualmente.

---

## Por que Python é uma boa escolha aqui

### Acesso a hardware via psutil e nvidia-ml-py

`psutil` é a biblioteca de fato para coleta de métricas de sistema em Python. Ela abstrai as diferenças entre kernels Linux (leitura de `/proc`, `/sys`, sensores via `lm-sensors`) e retorna dados já normalizados. A alternativa em Go ou Rust exigiria parsear `/proc` manualmente ou depender de crates/bindings menos maduros.

`nvidia-ml-py` é o binding oficial da NVIDIA para NVML — a mesma API que ferramentas como `nvidia-smi` usam. Não existe alternativa equivalente fora do ecossistema Python/C.

### Integração com o sistema operacional Linux

O agente precisa:
- Chamar `subprocess` para `ssh-keygen`, `systemctl`, `setfacl`, `groupadd`, `who`
- Ler/escrever em `/sys/fs/cgroup/`, `/proc/`, `/home/<user>/.ssh/`
- Manipular permissões com `os.chown`, `pathlib`, `pwd.getpwnam`

Python oferece as APIs de alto nível certas para isso (`subprocess`, `os`, `pathlib`, `pwd`, `grp`), sem a verbosidade de Java nem a complexidade de gerenciamento de memória de C/Rust.

### Custo de runtime

O agente é um processo de longa duração com I/O baixo e sem carga computacional. O overhead do interpretador Python (~30–60 MB de RSS) é desprezível num servidor com dezenas de GB de RAM. O GIL não é problema porque as três threads fazem quase exclusivamente I/O (HTTP + syscalls), não CPU.

### Velocity de desenvolvimento

Para um projeto de TCC com escopo bem definido e iterações rápidas, Python acelera significativamente o ciclo de desenvolvimento. Adicionar um novo coletor de métrica é uma função de 5 linhas. Adicionar um novo endpoint é um método no `api_client.py` e uma chamada no `agent.py`.

---

## Pontos de atenção na estrutura atual

### 1. `agent.py` concentra demais

O orquestrador hoje controla: estado da alocação atual, lógica de heartbeat, lógica de SSH polling, lógica de telemetria, e resposta a eventos de ciclo de vida. À medida que o projeto cresce (ex: múltiplas alocações simultâneas no futuro, ou integração com LXD), esse arquivo vai acumular lógica de negócio.

**Mitigação recomendada**: extrair uma classe `AllocationState` que encapsula o estado da alocação ativa (username, id, timestamps) e é passada entre os módulos — evitando variáveis de instância espalhadas em `agent.py`.

### 2. Polling vs. WebSocket/SSE

Atualmente o agente usa polling com `time.sleep()` em threads separadas:
- **Heartbeat: 5s** — envia `connectedUsers`, recebe `shouldBlock`, `currentAllocation` e `pendingRevocations`
- **Telemetria: 5s** — envia métricas de hardware
- **SSH: 5s** — verifica chaves pendentes e revogações

**Por que heartbeat a cada 5s (não 30s)?**

O heartbeat é o único canal pelo qual o agente recebe `pendingRevocations` — revogações de sessão SSH solicitadas pelo admin. Com 30s, o usuário esperaria até 30s para ter a chave removida. Com 5s, a latência máxima de execução é de 5s, o que para o admin parece instantâneo.

**Impacto de performance (5s vs. 30s):**

Com 10 servidores, o heartbeat a cada 5s gera **2 req/s** na API. Cada heartbeat executa:
- 1 `UPDATE` em `machines` (`lastSeenAt`)
- 2 `SELECT` para alocação atual e próxima
- 1 invalidação de cache — **somente quando `loggedUser` ou `status` mudam** (estado estável não invalida)

São ~30 operações de banco por segundo no total — negligenciável para SQLite. O custo real seria relevante apenas acima de ~100 servidores simultâneos.

Para o caso de uso do laboratório (poucos servidores, latência de resposta de segundos é aceitável), **polling é suficiente e mais simples de depurar**. Uma conexão WebSocket persistente traria complexidade (reconexão, backpressure, estado de sessão) sem ganho real para esse workload.

### 3. Detecção de usuários conectados via SSH (utmp)

O agente detecta quem está conectado ao servidor via SSH lendo `/var/run/utmp` — o arquivo binário estruturado que o kernel Linux mantém atomicamente. O comando `who -q` é apenas um leitor conveniente desse arquivo; o formato é definido por POSIX (`struct utmp`) e não muda entre versões do OpenSSH ou distribuições.

```
Usuário abre SSH
  └── sshd aceita conexão
        └── PAM abre sessão → kernel grava entrada em /var/run/utmp
              └── `who -q` inclui o usuário na lista

Usuário fecha SSH (exit, timeout, queda de rede)
  └── sshd detecta encerramento
        └── PAM fecha sessão → kernel remove entrada do utmp
              └── `who -q` não mostra mais o usuário
```

**Implementação no agente:**

```python
import subprocess

def usuarios_conectados() -> list[str]:
    result = subprocess.run(['who', '-q'], capture_output=True, text=True)
    # -q: só imprime nomes + "# users=N"
    # Exemplo de saída: "aluno.silva\n# users=1"
    return [l for l in result.stdout.strip().splitlines() if not l.startswith('#') and l.strip()]
```

O resultado é enviado no corpo do heartbeat:

```json
{ "connectedUsers": ["aluno.silva"] }
```

A API atualiza `machine.loggedUser` (primeiro da lista) e `machine.status` (`occupied`/`available`) com base nessa informação. Se há usuários conectados mas nenhuma alocação ativa, a API retorna `shouldBlock: true` com `blockReason: 'NO_VALID_ALLOCATION'` — o agente pode usar isso para forçar desconexão ou apenas alertar o admin.

**Por que não usar parsing de log (journald/syslog):**
- O formato das mensagens do sshd muda entre versões do OpenSSH
- Detectar desconexão por log é ambíguo (timeout de rede, queda limpa, etc.)
- Reconstruir o estado atual exige replay do histórico desde o boot
- utmp é sempre o estado atual, sem replay

### 4. Ausência de retry com backoff

`api_client.py` não implementa retry com backoff exponencial. Se a API estiver indisponível por alguns segundos (restart, deploy), o agente descarta os dados silenciosamente. Para telemetria isso é tolerável (perder alguns pontos num gráfico não é crítico), mas para operações de SSH setup a perda pode causar inconsistência.

**Mitigação**: adicionar `tenacity` ou retry manual apenas nas operações de SSH (`ssh/setup`, `ssh/teardown`), não na telemetria.

### 4. Autenticação: apenas Bearer token

O agente envia um único header em todo request:

```
Authorization: Bearer <MACHINE_TOKEN>
```

O `MACHINE_TOKEN` é uma string hex de 128 caracteres (256 bits de entropia), gerada no cadastro da máquina pelo admin e salva no `.env` do agente. O `MachineAuthMiddleware` valida o token contra o banco (com cache de 5 minutos no `MachineCache`) e injeta o objeto `machine` no contexto HTTP.

Não há verificação de MAC ou IP — a rede local do laboratório é considerada segura o suficiente para o escopo do MVP, e requisitos extras de autenticação introduziriam dependências operacionais (IP fixo via DHCP reservation, configuração de rede) sem ganho de segurança proporcional dentro de uma LAN controlada.

### 5. Rotação de token

O admin pode rotacionar o token de qualquer máquina pelo painel web via:

```
POST /api/v1/machines/:id/regenerate-token
```

O backend:
1. Invalida o token antigo no `MachineCache` imediatamente
2. Gera novo token com `crypto.randomBytes(64).toString('hex')`
3. Salva no banco com `tokenRotatedAt = DateTime.now()`
4. Retorna `{ token, tokenRotatedAt }` ao admin

**Fluxo de entrega do novo token ao agente:**

```
Admin (painel web)
  └── POST /regenerate-token
        └── API salva novo token no banco
              └── Admin copia o token da resposta
                    └── Acessa o servidor via SSH
                          └── Edita /opt/lab-agent/.env
                                └── systemctl restart lab-agent
                                      └── Agente inicia com novo token
```

Não há distribuição automática do token — o admin entrega manualmente via SSH. Isso é intencional: a entrega automática exigiria um canal de comunicação autenticado separado, o que re-introduz o problema circular ("como autenticar o canal que entrega a nova autenticação?"). Para laboratório com poucos servidores e acesso SSH ao admin, a troca manual é simples e segura.

**Garantia de continuidade durante a troca:**

- O agente continua operando com o token antigo até ser reiniciado
- O token antigo deixa de funcionar imediatamente após o `regenerate-token` (cache invalidado, banco atualizado)
- Há uma janela de inatividade de ~5-10 segundos entre o `systemctl stop` e o `systemctl start` — aceitável, pois a telemetria usa polling e o heartbeat de 30s tolera gaps curtos
- O banco nunca fica em estado inconsistente: a troca é atômica (UPDATE no banco + invalidação do cache)

### 6. Ciclo de vida da alocação e acesso SSH

O fim de uma alocação **não significa perda de acesso ao servidor** — significa perda de *prioridade de recursos*. O fluxo correto ao expirar uma alocação é:

```
Alocação expira (horário de fim atingido)
  ├── Agente aplica CPUWeight=10 e IOWeight=10 no slice do usuário
  │     (reduz prioridade sem matar processos)
  │     !! NEM MemoryMax NEM MemoryHigh são aplicados ao ex-dono !!
  │     (simulações em andamento podem usar 60–90% da RAM — um hard
  │      limit de memória causaria OOM e mataria o processo)
  └── Agente revoga a chave SSH temporária da sessão
        └── Remove a linha do authorized_keys pelo fingerprint
              (a chave foi gerada só para esta sessão, não é a chave pessoal do usuário)

O usuário CONTINUA podendo:
  ├── Manter a sessão SSH já aberta pelo tempo que precisar
  ├── Abrir nova sessão via senha de sistema ou chave pessoal
  ├── Copiar arquivos (scp, rsync) com prioridade de I/O reduzida
  └── Coletar resultados e dados da simulação normalmente
```

**Tabela de cgroup por estado:**

| Estado do usuário | CPUWeight | IOWeight | MemoryMax |
|---|---|---|---|
| Dono com alocação ativa | 1000 | 1000 | *sem limite* |
| Usuário de fundo (convidado) | 10 | 10 | 20% |
| Ex-dono após expiração | 10 | 10 | *sem limite* |
| Admin revogou explicitamente | 10 | 10 | 20% |

**O acesso é encerrado somente quando o admin revoga explicitamente** — ex: precisa da máquina para outra alocação urgente ou detectou comportamento inadequado.

**Revogação forçada pelo admin (fluxo):**

O admin não consegue enviar um comando direto ao agente porque o agente só faz conexões de saída. A solução é incluir revogações pendentes no retorno do `GET /api/agent/ssh/pending`, que o agente já faz a cada **5 segundos**:

```
Admin clica "Revogar" no painel
  └── DELETE /api/v1/ssh-sessions/:id
        └── API marca session.status = 'revoked' no banco

Agente (próximo polling de 5s)
  └── GET /api/agent/ssh/pending
        └── Resposta inclui: pendingRevocations: [{ sessionId, fingerprint }]
              └── Agente chama ssh_manager.revoke(fingerprint)
                    ├── Remove linha do authorized_keys
                    └── POST /api/agent/ssh/teardown → confirma para a API
```

Latência de ~5 segundos entre o clique do admin e a execução. Para o admin, isso é "instantâneo" sem nenhuma complexidade de WebSocket ou SSE.

### 7. Threads vs. asyncio

O código usa `threading.Thread` com `time.sleep()`. Para o número de operações concorrentes atual (3 threads, I/O bound), threads são adequadas. Migrar para `asyncio` só faria sentido se o número de operações concorrentes crescesse muito (ex: agente gerenciando dezenas de containers simultaneamente).

### 8. Confiabilidade — regras obrigatórias de implementação

O ambiente é de **alta confiabilidade**: simulações rodam por dias e não podem ser interrompidas por um bug no agente. As regras abaixo são não-negociáveis na implementação do agente novo.

#### R1 — Thread nunca morre por exceção

Cada loop de thread deve ter `try/except Exception` **no nível do loop**, não dentro dos métodos chamados. Isso garante que uma falha pontual (timeout de rede, erro de parse, leitura de sensor falhando) pule a iteração sem matar a thread:

```python
def _heartbeat_loop(self):
    while self.running:
        try:
            self._do_heartbeat()
        except Exception:
            logger.exception('Erro no heartbeat — continuando')
        time.sleep(HEARTBEAT_INTERVAL)
```

Sem esse guard, uma exceção não capturada mata a thread silenciosamente. O processo principal continua vivo (systemd não reinicia), mas a funcionalidade está morta.

#### R2 — Agente nunca aplica MemoryMax ao ex-dono

Ao expirar uma alocação, o agente aplica apenas redução de `CPUWeight` e `IOWeight`. **Nunca aplica `MemoryMax` ao slice do ex-dono.** Simulações em andamento podem usar 60–90% da RAM — um hard limit causaria OOM kill do processo pelo kernel. `MemoryMax` só é aplicado a usuários de fundo (convidados), nunca ao ex-dono em downgrade.

#### R3 — Operações em `authorized_keys` são atômicas com lock

O `ssh_manager` deve usar `fcntl.flock(fd, fcntl.LOCK_EX)` antes de qualquer leitura ou escrita no `authorized_keys`. Isso evita condição de corrida se duas revogações chegarem ao mesmo tempo via polling.

#### R4 — Chaves privadas nunca ficam em disco

A chave privada gerada por `ssh-keygen` deve ser lida e imediatamente apagada do disco, dentro de um bloco `try/finally` com `shutil.rmtree()` no diretório temporário. Se o processo for interrompido entre a geração e a limpeza, `main.py` deve limpar diretórios `lab_ssh_*` em `/tmp/` na inicialização.

#### R5 — Falha de rede nunca bloqueia o agente

Todas as chamadas HTTP em `api_client.py` devem ter `timeout` explícito (10s) e capturar `requests.exceptions.RequestException` sem propagar. O agente deve continuar funcionando — com cgroups e SSH já aplicados — mesmo se a API ficar indisponível por minutos ou horas.

#### R6 — `systemd` como watchdog definitivo

O `install.sh` configura `Restart=always` e `RestartSec=10`. O agente não precisa de watchdog interno — o systemd é a camada de recuperação. O agente só precisa sair limpo (código 0 ou 1), sem travar indefinidamente. Para isso, o `stop()` deve ter timeout nas operações de cleanup (revogação de SSH, reset de cgroup): se uma operação demorar mais de 5s, loga e segue.

---

## Adequação ao objetivo do projeto

| Requisito | Cobertura atual | Status |
|-----------|----------------|--------|
| Rodar como serviço systemd | `install.sh` cria `lab-server-agent.service` | ✅ Implementado |
| Telemetria de hardware (CPU, GPU, RAM, disco, rede) | `hardware.py` com psutil + pynvml | ✅ Implementado (expandir) |
| Gerenciar conexões SSH para o usuário alocado | `ssh_manager.py` + polling `ssh/pending` | ✅ Implementado |
| Prioridade de CPU para o dono da alocação | `cgroup_manager.py` CPUWeight via systemd | ✅ Implementado |
| Limite de memória e IO para usuários de fundo | — | 🔲 Planejado (resource_manager.py) |
| Diretório compartilhado para outros usuários | — | 🔲 Planejado (ACL ~/shared/) |
| Métricas enriquecidas (VRAM, power, fan, IO, processos) | — | 🔲 Planejado (hardware.py rewrite) |
| Suporte a containers LXD | — | ⏳ Futuro (fora do escopo atual) |
| Autenticação por Bearer token | `api_client.py` envia `Authorization: Bearer <token>`; `MachineAuthMiddleware` valida com cache de 5min | ✅ Implementado |
| Sincronizar specs da máquina na inicialização | `sync-specs` no `start()` | ✅ Implementado |

A arquitetura atual é **sólida para o escopo do MVP**. Os módulos são independentes, o fluxo é simples de rastrear, e a adição de novos recursos (resource_manager, hardware enriquecido) segue o padrão já estabelecido sem exigir refatoração estrutural.

O único risco real de escala é o `agent.py` acumular responsabilidades — mas isso é mitigável com a extração de `AllocationState` descrita acima, sem reescrever a arquitetura.
