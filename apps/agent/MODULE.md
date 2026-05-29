# Módulo Agente

## Papel

O agente roda localmente nas máquinas do laboratório e é responsável por:

- aplicar decisões de acesso (bloquear/liberar sessão);
- coletar telemetria de hardware e processos;
- viabilizar acesso SSH temporário (apenas no agente de servidor).

## Variantes

- **Agente PC**: inclui interface local (overlay/login) e fluxo de validação de credenciais.
- **Agente Servidor**: opera headless, gerencia chaves SSH e controla recursos via cgroups.

## Ciclos de comunicação

- **Heartbeat** (`POST /api/agent/heartbeat`): envia estado local e recebe decisão (`shouldBlock`, alocação atual/próxima, revogações pendentes).
- **Telemetria** (`POST /api/agent/telemetry`): envia métricas periódicas (CPU/GPU/RAM, rede, processos em JSON).
- **SSH (servidor)**:
  - `GET /api/agent/ssh/pending` para descobrir requisições;
  - `POST /api/agent/ssh/setup` e `POST /api/agent/ssh/teardown` para confirmar instalação/remoção de chaves.

## Autenticação

- O agente autentica via token da máquina (`Authorization: Bearer <token>`).

## Saídas locais

- Atualização de `authorized_keys` com a chave pública de sessão.
- Aplicação de políticas de acesso (bloqueio de sessão gráfica ou restrição via cgroups).
- Coleta de telemetria enriquecida, com fallback quando GPU não está disponível.
