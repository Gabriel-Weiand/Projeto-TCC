# Sistema Distribuído de Gestão de Laboratórios

Este projeto é parte fundamental do Trabalho de Conclusão de Curso (TCC) na Universidade Federal de Pelotas (Ufpel). Ele tem como objetivo abranger uma solução completa para o gerenciamento de alocação, monitoramento e controle de acesso em máquinas de laboratórios universitários de pesquisa. O sistema tem como objetivo operar em uma arquitetura distribuída composta por uma API central, um dashboard e site para alocações web e agentes locais instalados nas máquinas.

## 🎯 Contexto e Solução

Atualmente, a gestão de recursos computacionais em alguns laboratórios de pesquisa depende de planilhas e comunicação informal, o que compromete a eficiência e a segurança dos ativos.

A solução foi projetada sob a ótica de **Sistemas Distribuídos**, visando garantir a convergência entre:

1.  **Estado Desejado:** O agendamento definido no sistema web.
2.  **Estado Real:** O comportamento efetivo da máquina física no laboratório.

## 🏛 Arquitetura do Sistema

O projeto adota uma estrutura de **Monorepo** organizada, onde a API Central orquestra as regras de negócio para dois clientes distintos. A arquitetura foca na separação de responsabilidades de autenticação:

1.  **Backend (API Central):** Desenvolvido em **AdonisJS 6**, atua como a fonte da verdade. Gerencia duas frentes de autenticação:
    - _Usuários:_ Autenticação via Sessão/Cookie (Stateful) ou JWT.
    - _Agentes:_ Autenticação via Tokens Perpétuos (API Keys).
2.  **Frontend (Web):** Interface para alunos solicitarem uso e administradores gerenciarem o parque.
3.  **Agent (Máquinas Gerenciadas):** Software local (Daemon) que consulta a API para saber se deve permitir o uso ao hardware e reporta telemetria.

---

## 🚀 Funcionalidades (MVP)

### 👤 Usuários & Acesso

- **Autenticação Híbrida:** Login tradicional para usuários e "Handshake" seguro para os agentes instalados.
- **Role-Based Access Control (RBAC):** Diferenciação estrita entre `Student` e `Admin`.

### 📅 Alocação de Recursos (Modelo Otimista)

- **Aprovação Automática:** Visando agilidade no MVP, solicitações de alunos autenticados nascem com status `APPROVED`.
- **Controle Reativo:** O Administrador monitora alocações ativas e pode alterá-las para `DENIED`. Isso aciona o bloqueio imediato na máquina física via Agente.
- **Privacidade:** Alunos veem a ocupação do laboratório (mapa de máquinas), mas os dados de _quem_ está usando são anonimizados para não-admins.

### 🖥️ Gestão de Ativos & Telemetria

- **Sincronização de Estado:** O Agente consulta periodicamente ("Heartbeat") a API para alinhar o estado local (Bloqueado/Liberado).
- **Auditoria de Hardware:** Coleta de métricas (CPU/RAM) para identificar uso indevido ou máquinas ociosas.
- **Soft Deletes:** Preservação de histórico para auditoria.

---

## 🔌 API Endpoints (Core)

A API é segmentada por prefixos para isolar a lógica de humanos da lógica de máquinas.

### 1. Rotas de Interface (`/api/v1`)

_Destinadas ao Frontend Web (Usuários Interativos)._

#### Users (Gerenciamento)

| Método   | Endpoint     | Descrição                                       | Permissão     |
| :------- | :----------- | :---------------------------------------------- | :------------ |
| `POST`   | `/users`     | Cadastro de usuário (Público ou Admin).         | Público       |
| `GET`    | `/users`     | Listar todos os usuários.                       | Admin         |
| `PUT`    | `/users/:id` | Atualizar dados do perfil (Senha, Nome).        | Próprio/Admin |
| `DELETE` | `/users/:id` | **Excluir usuário** (Remove acesso ao sistema). | Admin         |

#### Allocations (Solicitações)

| Método  | Endpoint           | Descrição                                                            |
| :------ | :----------------- | :------------------------------------------------------------------- |
| `POST`  | `/allocations`     | Solicitar uso (Gera `APPROVED` por padrão).                          |
| `GET`   | `/allocations`     | Listar alocações. _Filtra dados sensíveis para Alunos._              |
| `PATCH` | `/allocations/:id` | Revogar acesso (`DENIED` - Admin) ou Cancelar (`CANCELLED` - Aluno). |

#### Machines (Management & View)

| Método   | Endpoint                  | Descrição                                                      | Permissão |
| :------- | :------------------------ | :------------------------------------------------------------- | :-------- |
| `POST`   | `/machines`               | Cadastrar nova máquina e gerar **Machine Token**.              | Admin     |
| `GET`    | `/machines`               | Listar inventário e status atual.                              | Auth      |
| `DELETE` | `/machines/:id`           | Remoção lógica (Soft Delete).                                  | Admin     |
| `GET`    | `/machines/:id/telemetry` | **Visualizar histórico** de uso (CPU/RAM) enviado pelo agente. | Admin     |

### 2. Rotas de Agente (`/api/agent`)

_Destinadas ao software embarcado. Requer Header `Authorization: Bearer <MACHINE_TOKEN>`._

#### Synchronization & Telemetry

| Método | Endpoint              | Descrição                                                                     |
| :----- | :-------------------- | :---------------------------------------------------------------------------- |
| `GET`  | `/machines/sync`      | **Heartbeat:** Agente pergunta "Devo bloquear?". API responde `true`/`false`. |
| `POST` | `/machines/telemetry` | Envio de dados de hardware (CPU, RAM, Uptime).                                |

---

## 🛠 Tech Stack

- **Backend:** Node.js, AdonisJS 6, TypeScript.
- **Banco de Dados:** SQLite (Configurado com WAL Mode para alta concorrência).
- **Frontend:** (A definir).
- **Agent:** (A definir).

---

## 📦 Como Rodar
