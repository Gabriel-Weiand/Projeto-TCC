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

## 🔌 API Endpoints

A API é segmentada por prefixos e versões para isolar a lógica de interação humana da lógica de automação das máquinas.

**Base URL:** `/api/v1` (Para rotas de interface)
**Agent URL:** `/api/agent` (Para rotas de hardware)

### 1. Interface & Gestão (`/api/v1`)

_Destinadas ao Frontend Web/Mobile. Requer Header `Authorization: Bearer <USER_TOKEN>` (exceto login)._

#### 🔐 Auth & Perfil

| Método   | Endpoint  | Descrição                             | Permissão   |
| :------- | :-------- | :------------------------------------ | :---------- |
| `POST`   | `/login`  | Autenticação e geração de token JWT.  | **Público** |
| `DELETE` | `/logout` | Invalidação do token atual.           | Geral       |
| `GET`    | `/me`     | Retorna dados do usuário autenticado. | Geral       |

#### 👥 Users (Usuários)

| Método   | Endpoint                 | Descrição                                       | Permissão |
| :------- | :----------------------- | :---------------------------------------------- | :-------- |
| `POST`   | `/users`                 | Cadastrar novo usuário.                         | Admin     |
| `GET`    | `/users`                 | Listar todos os usuários.                       | Admin     |
| `GET`    | `/users/:id`             | Detalhes de um usuário específico.              | Admin     |
| `PUT`    | `/users/:id`             | Atualizar perfil (Nome, Senha).                 | Geral     |
| `DELETE` | `/users/:id`             | Remover usuário (Soft Delete ou Cascata).       | Admin     |
| `GET`    | `/users/:id/allocations` | Histórico de reservas de um usuário específico. | Admin     |

#### 🖥️ Machines (Laboratórios)

| Método   | Endpoint                    | Descrição                                          | Permissão |
| :------- | :-------------------------- | :------------------------------------------------- | :-------- |
| `POST`   | `/machines`                 | Cadastrar máquina e gerar **API Key**.             | Admin     |
| `GET`    | `/machines`                 | Inventário de máquinas e especificações.           | Geral     |
| `GET`    | `/machines/:id`             | Detalhes técnicos da máquina.                      | Admin     |
| `DELETE` | `/machines/:id`             | Remover máquina.                                   | Admin     |
| `GET`    | `/machines/:id/telemetry`   | Visualizar histórico bruto de telemetria (Gráfico) | Admin     |
| `GET`    | `/machines/:id/allocations` | Listar reservas futuras desta máquina.             | Geral     |

#### 📅 Allocations (Reservas & Sessões)

| Método  | Endpoint                   | Descrição                                              | Permissão |
| :------ | :------------------------- | :----------------------------------------------------- | :-------- |
| `POST`  | `/allocations`             | Solicitar acesso a uma máquina.                        | Geral     |
| `GET`   | `/allocations`             | Listar histórico de alocações.                         | Geral     |
| `PATCH` | `/allocations/:id`         | Alterar status (Cancelar, Negar).                      | Geral     |
| `POST`  | `/allocations/:id/summary` | **Encerrar Sessão:** Consolida dados e gera relatório. | Admin     |
| `GET`   | `/allocations/:id/summary` | **Ver Resumo:** Retorna métricas (Médias CPU/RAM).     | Geral     |

#### 🧹 Data Maintenance (Sistema)

_Rotas administrativas para limpeza de dados e correções pontuais._

| Método   | Endpoint                           | Descrição                                              |
| :------- | :--------------------------------- | :----------------------------------------------------- |
| `DELETE` | `/telemetries/:id`                 | Apagar um registro de telemetria bruto específico.     |
| `DELETE` | `/allocation-metrics/:id`          | Apagar um relatório de resumo de sessão específico.    |
| `DELETE` | `/system/prune/telemetries`        | **Prune:** Limpa dados brutos antigos (`?days=7`).     |
| `DELETE` | `/system/prune/allocations`        | **Prune:** Limpa histórico de reservas (`?days=3650`). |
| `DELETE` | `/system/prune/allocation-metrics` | **Prune:** Limpa resumos antigos (`?days=365`).        |

---

### 2. Rotas do Agente (`/api/agent`)

_Destinadas ao software embarcado na máquina. Requer Header `Authorization: Bearer <MACHINE_TOKEN>`._

| Método | Endpoint           | Descrição                                                                |
| :----- | :----------------- | :----------------------------------------------------------------------- |
| `POST` | `/validate-access` | **Login Local:** Valida se as credenciais do aluno conferem com o banco. |
| `POST` | `/telemetry`       | **Push:** Envia pacote de métricas (CPU, RAM, Temp) a cada 10s.          |

## 🛠 Tech Stack

- **Backend:** Node.js, AdonisJS 6, TypeScript.
- **Banco de Dados:** SQLite (Configurado com WAL Mode para alta concorrência).
- **Frontend:** (A definir).
- **Agent:** (A definir).

---

## 📦 Como Rodar
