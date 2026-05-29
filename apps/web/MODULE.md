# Módulo Web

## Papel

Aplicação SPA para alunos e administradores. A interface centraliza reservas, consulta de máquinas, e exibição de métricas de uso.

## Comunicação com a API

- **Autenticação**: login em `/api/v1/login`, token salvo localmente e enviado em todas as requisições.
- **Reservas**: CRUD de alocações, com validação de conflitos e estados (pending/approved/denied).
- **Máquinas**: listagem, detalhe, telemetria recente e histórico consolidado.
- **Notificações**: consumo de inbox para aprovações, recusas e manutenção.
- **SSH**: fluxo de solicitação de chave e validação do fingerprint antes da primeira conexão.

## Estado local

- Stores (Pinia) para sessão do usuário, reservas e máquinas.
- Sincronização de tempo com a API para evitar divergência de relógio no navegador.

## Saídas

- Interface para usuários finais (reserva, acompanhamento de sessão, conexão SSH).
- Painel admin para gerenciar parque de máquinas e auditoria.
