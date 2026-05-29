# Módulo API

## Papel

A API centraliza regras de negócio, autenticação e persistência. Ela orquestra a comunicação entre frontend e agentes, e consolida as métricas de telemetria em dados de sessão.

## Entradas de comunicação

- **Frontend Web**: rotas REST sob `/api/v1` para login, CRUD de usuários, máquinas e alocações, além de leitura de métricas e notificações.
- **Agentes**: rotas sob `/api/agent` para heartbeat, validação de login local, telemetria, e fluxo SSH (pending/setup/teardown).

## Saídas de comunicação

- **Para agentes**: respostas de heartbeat com `shouldBlock`, `currentAllocation`, `nextAllocation` e instruções pendentes (ex: revogar acesso SSH no ciclo seguinte).
- **Para frontend**: dados de alocação, máquinas e métricas consolidadas, além de notificações de sistema.

## Persistência (migrations atuais)

- `users` com `system_username` e `ssh_public_key`.
- `machines` com token do agente, specs e status.
- `allocations` com janela de uso e `is_sudo`.
- `telemetries` com amostras brutas e processos em JSON.
- `allocation_metrics` com médias e picos por sessão.
- `ssh_connection_attempts` para auditoria de segurança.
- `notifications` como caixa de entrada por usuário.

## Consolidação de telemetria

- **Média ponderada pelo tempo (TWA):**

$TWA = \frac{\sum (v_i \cdot \Delta t_i)}{T_{total}}$

- **Fallback de GPU:** dados nulos/zerados de GPU são ignorados na consolidação, sem interromper o cálculo das demais métricas.

## Observações

- `system_username` deve ser estável/imutável por regra de negócio (a constraint explícita não está no schema).
- Caso a autenticação do agente use MAC address, o schema precisa armazenar este campo na tabela `machines`.
