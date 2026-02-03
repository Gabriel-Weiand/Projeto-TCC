# Documentação do Sistema de Gerenciamento de Laboratórios

## Sumário

1. [Introdução](#1-introdução)
2. [Arquitetura do Sistema](#2-arquitetura-do-sistema)
   - 2.1 [Visão Geral](#21-visão-geral)
   - 2.2 [Diagrama de Componentes](#22-diagrama-de-componentes)
   - 2.3 [Diagrama de Entidade-Relacionamento](#23-diagrama-de-entidade-relacionamento)
   - 2.4 [Fluxo de Comunicação](#24-fluxo-de-comunicação)
3. [Back-end (API)](#3-back-end-api)
   - 3.1 [Tecnologias Utilizadas](#31-tecnologias-utilizadas)
   - 3.2 [Estrutura do Projeto](#32-estrutura-do-projeto)
   - 3.3 [Autenticação e Segurança](#33-autenticação-e-segurança)
   - 3.4 [Endpoints da API](#34-endpoints-da-api)
   - 3.5 [Regras de Negócio](#35-regras-de-negócio)
4. [Agente de Máquina](#4-agente-de-máquina)
   - 4.1 [Responsabilidades](#41-responsabilidades)
   - 4.2 [Diagrama de Estados](#42-diagrama-de-estados)
   - 4.3 [Ciclo de Heartbeat](#43-ciclo-de-heartbeat)
5. [Front-end (Web)](#5-front-end-web)
   - 5.1 [Visão Geral](#51-visão-geral)
   - 5.2 [Funcionalidades Planejadas](#52-funcionalidades-planejadas)
   - 5.3 [Interfaces Principais](#53-interfaces-principais)
6. [Considerações Finais](#6-considerações-finais)

---

## 1. Introdução

Este documento apresenta a arquitetura e implementação do Sistema de Gerenciamento de Laboratórios de Informática, desenvolvido como Trabalho de Conclusão de Curso (TCC). O sistema visa otimizar o uso de recursos computacionais em laboratórios acadêmicos através de reservas, monitoramento em tempo real e controle de acesso.

### Objetivos do Sistema

- **Gerenciamento de Reservas**: Permitir que usuários reservem máquinas para períodos específicos
- **Controle de Acesso**: Validar credenciais e bloquear máquinas não reservadas
- **Monitoramento**: Coletar telemetria de uso (CPU, memória, disco)
- **Otimização de Recursos**: Fornecer dados para análise de utilização dos laboratórios

---

## 2. Arquitetura do Sistema

### 2.1 Visão Geral

O sistema segue uma arquitetura distribuída cliente-servidor com três componentes principais:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SISTEMA DE LABORATÓRIOS                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐   │
│   │              │     │              │     │                      │   │
│   │   FRONT-END  │────▶│     API      │◀────│   AGENTES DE         │   │
│   │   (Web App)  │     │   (AdonisJS) │     │   MÁQUINA            │   │
│   │              │     │              │     │                      │   │
│   └──────────────┘     └──────┬───────┘     └──────────────────────┘   │
│                               │                                         │
│                               ▼                                         │
│                        ┌──────────────┐                                 │
│                        │   DATABASE   │                                 │
│                        │   (SQLite)   │                                 │
│                        └──────────────┘                                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API (AdonisJS)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │   Controllers   │  │   Middleware    │  │        Services             │ │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────────────────┤ │
│  │ AgentController │  │ AuthMiddleware  │  │ MachineCache (TTL: 5min)   │ │
│  │ AuthController  │  │ MachineAuth     │  │ TelemetryBuffer (batch)    │ │
│  │ UsersController │  │ IsAdmin         │  └─────────────────────────────┘ │
│  │ MachinesCtrl    │  │ ForceJSON       │                                  │
│  │ AllocationsCtrl │  └─────────────────┘  ┌─────────────────────────────┐ │
│  │ TelemetriesCtrl │                       │        Models               │ │
│  └─────────────────┘  ┌─────────────────┐  ├─────────────────────────────┤ │
│                       │   Validators    │  │ User, Machine, Allocation  │ │
│                       ├─────────────────┤  │ Telemetry, AllocationMetric│ │
│                       │ VineJS Schemas  │  │ AccessToken                │ │
│                       └─────────────────┘  └─────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Diagrama de Entidade-Relacionamento

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│      USERS       │       │   ACCESS_TOKENS  │       │    MACHINES      │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (PK)          │──────<│ tokenable_id(FK) │       │ id (PK)          │
│ full_name        │       │ type             │       │ name             │
│ email (UNIQUE)   │       │ name             │       │ api_key (UNIQUE) │
│ password         │       │ hash             │       │ cpu_model        │
│ role (enum)      │       │ abilities        │       │ ram_gb           │
│ created_at       │       │ created_at       │       │ disk_gb          │
│ updated_at       │       │ updated_at       │       │ os               │
└──────────────────┘       │ last_used_at     │       │ status (enum)    │
         │                 │ expires_at       │       │ last_heartbeat   │
         │                 └──────────────────┘       │ created_at       │
         │                                            │ updated_at       │
         │                                            └──────────────────┘
         │                                                     │
         │                 ┌──────────────────┐                │
         │                 │   ALLOCATIONS    │                │
         │                 ├──────────────────┤                │
         └────────────────>│ user_id (FK)     │<───────────────┘
                           │ machine_id (FK)  │
                           │ starts_at        │
                           │ ends_at          │
                           │ actual_login     │
                           │ actual_logout    │
                           │ created_at       │
                           │ updated_at       │
                           └────────┬─────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         │                                                      │
         ▼                                                      ▼
┌──────────────────┐                               ┌──────────────────────┐
│   TELEMETRIES    │                               │  ALLOCATION_METRICS  │
├──────────────────┤                               ├──────────────────────┤
│ id (PK)          │                               │ id (PK)              │
│ machine_id (FK)  │                               │ allocation_id (FK)   │
│ cpu_percent      │                               │ avg_cpu_percent      │
│ ram_percent      │                               │ avg_ram_percent      │
│ disk_percent     │                               │ avg_disk_percent     │
│ created_at       │                               │ peak_cpu_percent     │
│                  │                               │ peak_ram_percent     │
└──────────────────┘                               │ samples_count        │
                                                   │ created_at           │
                                                   │ updated_at           │
                                                   └──────────────────────┘
```

### 2.4 Fluxo de Comunicação

#### Fluxo do Agente (Heartbeat)

```
┌─────────┐                    ┌─────────┐                    ┌──────────┐
│ AGENTE  │                    │   API   │                    │ DATABASE │
└────┬────┘                    └────┬────┘                    └────┬─────┘
     │                              │                              │
     │  POST /api/agent/heartbeat   │                              │
     │  {telemetry: {...}}          │                              │
     │─────────────────────────────>│                              │
     │                              │   Verificar API Key          │
     │                              │   (MachineCache)             │
     │                              │                              │
     │                              │   Buscar alocação ativa      │
     │                              │─────────────────────────────>│
     │                              │<─────────────────────────────│
     │                              │                              │
     │                              │   Buffer telemetria          │
     │                              │                              │
     │  {                           │                              │
     │    machineId,                │                              │
     │    shouldBlock,              │                              │
     │    canQuickAllocate,         │                              │
     │    currentAllocation {...}   │                              │
     │  }                           │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
```

#### Fluxo de Login na Máquina

```
┌─────────┐                    ┌─────────┐                    ┌──────────┐
│ AGENTE  │                    │   API   │                    │ DATABASE │
└────┬────┘                    └────┬────┘                    └────┬─────┘
     │                              │                              │
     │  POST /api/agent/validate    │                              │
     │  {email, password}           │                              │
     │─────────────────────────────>│                              │
     │                              │   Validar credenciais        │
     │                              │─────────────────────────────>│
     │                              │<─────────────────────────────│
     │                              │                              │
     │  {valid: true/false,         │                              │
     │   hasAllocation: bool,       │                              │
     │   canQuickAllocate: bool}    │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
     │  [Se válido e tem alocação]  │                              │
     │  POST /api/agent/report-login│                              │
     │─────────────────────────────>│   Registrar actual_login     │
     │                              │─────────────────────────────>│
     │                              │                              │
```

---

## 3. Back-end (API)

### 3.1 Tecnologias Utilizadas

| Tecnologia     | Versão | Propósito                        |
| -------------- | ------ | -------------------------------- |
| **Node.js**    | 20+    | Runtime JavaScript               |
| **AdonisJS**   | 6.x    | Framework web full-stack         |
| **TypeScript** | 5.x    | Tipagem estática                 |
| **Lucid ORM**  | -      | Mapeamento objeto-relacional     |
| **VineJS**     | -      | Validação de dados               |
| **SQLite**     | 3.x    | Banco de dados (desenvolvimento) |

### 3.2 Estrutura do Projeto

```
apps/api/
├── app/
│   ├── controllers/          # Lógica de requisições HTTP
│   │   ├── agent_controller.ts
│   │   ├── allocations_controller.ts
│   │   ├── auth_controller.ts
│   │   ├── machines_controller.ts
│   │   └── users_controller.ts
│   ├── middleware/           # Interceptadores de requisição
│   │   ├── auth_middleware.ts
│   │   ├── machine_auth_middleware.ts
│   │   └── is_admin_middleware.ts
│   ├── models/               # Entidades do banco de dados
│   │   ├── user.ts
│   │   ├── machine.ts
│   │   ├── allocation.ts
│   │   └── telemetry.ts
│   ├── services/             # Serviços auxiliares
│   │   ├── machine_cache.ts  # Cache de autenticação
│   │   └── telemetry_buffer.ts
│   └── validators/           # Esquemas de validação
├── config/                   # Configurações do framework
├── database/
│   ├── migrations/           # Versionamento do schema
│   └── seeders/              # Dados de teste
├── start/
│   ├── routes.ts             # Definição de rotas
│   └── kernel.ts             # Middlewares globais
└── tests/                    # Testes automatizados
```

### 3.3 Autenticação e Segurança

#### Autenticação de Usuários (JWT-like Tokens)

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUXO DE AUTENTICAÇÃO                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Login: POST /api/auth/login                             │
│     Body: { email, password }                               │
│     Response: { token, user }                               │
│                                                              │
│  2. Requisições autenticadas:                               │
│     Header: Authorization: Bearer <token>                   │
│                                                              │
│  3. Logout: DELETE /api/auth/logout                         │
│     Invalida o token atual                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Autenticação de Máquinas (API Key)

```
┌─────────────────────────────────────────────────────────────┐
│                   AUTENTICAÇÃO DE MÁQUINAS                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  • Cada máquina possui uma API Key única de 512 bits        │
│  • Header: X-Machine-Api-Key: <api_key>                     │
│  • Cache de 5 minutos para reduzir consultas ao banco       │
│  • Usado apenas nas rotas /api/agent/*                      │
│                                                              │
│  Geração da API Key:                                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ const apiKey = string.generateRandom(64) // 512 bits  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 Endpoints da API

#### Rotas Públicas

| Método | Rota                 | Descrição              |
| ------ | -------------------- | ---------------------- |
| POST   | `/api/auth/login`    | Autenticar usuário     |
| POST   | `/api/auth/register` | Registrar novo usuário |

#### Rotas de Usuário Autenticado

| Método | Rota               | Descrição                   |
| ------ | ------------------ | --------------------------- |
| GET    | `/api/auth/me`     | Dados do usuário logado     |
| DELETE | `/api/auth/logout` | Encerrar sessão             |
| GET    | `/api/allocations` | Listar alocações do usuário |
| POST   | `/api/allocations` | Criar nova alocação         |
| GET    | `/api/machines`    | Listar máquinas disponíveis |

#### Rotas Administrativas

| Método | Rota                | Descrição                |
| ------ | ------------------- | ------------------------ |
| GET    | `/api/users`        | Listar todos os usuários |
| POST   | `/api/users`        | Criar usuário            |
| PUT    | `/api/users/:id`    | Atualizar usuário        |
| DELETE | `/api/users/:id`    | Remover usuário          |
| POST   | `/api/machines`     | Cadastrar máquina        |
| PUT    | `/api/machines/:id` | Atualizar máquina        |
| DELETE | `/api/machines/:id` | Remover máquina          |

#### Rotas do Agente (Máquina)

| Método | Rota                        | Descrição              |
| ------ | --------------------------- | ---------------------- |
| POST   | `/api/agent/heartbeat`      | Heartbeat + telemetria |
| POST   | `/api/agent/validate-user`  | Validar credenciais    |
| GET    | `/api/agent/day-schedule`   | Agenda do dia          |
| POST   | `/api/agent/quick-allocate` | Alocação rápida (1h)   |
| POST   | `/api/agent/report-login`   | Reportar login         |
| POST   | `/api/agent/report-logout`  | Reportar logout        |
| POST   | `/api/agent/sync-specs`     | Sincronizar hardware   |
| POST   | `/api/agent/telemetry`      | Enviar telemetria      |

### 3.5 Regras de Negócio

#### Regra de Gap entre Alocações

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      REGRA DE 5 MINUTOS DE GAP                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Objetivo: Garantir tempo para troca de usuários entre sessões          │
│                                                                          │
│  Implementação:                                                          │
│  • Ao criar alocação, verificar conflito com gap de 5 minutos           │
│  • Alocação A (10:00-11:00) bloqueia criação de B antes de 11:05        │
│                                                                          │
│  Linha do tempo:                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 10:00      11:00  11:05      12:00                               │   │
│  │   │──────────│      │──────────│                                 │   │
│  │   │ Alocação │ GAP  │ Alocação │                                 │   │
│  │   │    A     │ 5min │    B     │                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Regra de Quick Allocate

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      REGRA DE QUICK ALLOCATE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Condições para permitir alocação rápida:                               │
│  1. Máquina não deve ter alocação ativa no momento                      │
│  2. Próxima alocação agendada deve estar a pelo menos 20 minutos        │
│  3. Duração máxima: 60 minutos                                          │
│  4. Duração padrão: mínimo entre 60 min e tempo até próxima alocação    │
│                                                                          │
│  Cenário permitido:                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ AGORA          +20min              +60min                        │   │
│  │   │              │                    │                          │   │
│  │   ├──────────────┼────────────────────┤                          │   │
│  │   │   LIVRE      │    Quick Allocate  │  Próxima alocação       │   │
│  │   │   (OK!)      │    (até 1h)        │  agendada               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Agente de Máquina

### 4.1 Responsabilidades

O agente de máquina é um software instalado em cada computador do laboratório, responsável por:

- **Comunicação**: Manter conexão com a API central via heartbeats periódicos
- **Autenticação Local**: Interceptar tentativas de login e validar permissões
- **Bloqueio de Tela**: Bloquear acesso quando não há alocação ativa
- **Coleta de Métricas**: Monitorar uso de CPU, memória e disco
- **Sincronização**: Reportar especificações de hardware

### 4.2 Diagrama de Estados

```
                              ┌─────────────────┐
                              │                 │
                              │   INICIALIZADO  │
                              │                 │
                              └────────┬────────┘
                                       │
                                       │ Conectar à API
                                       ▼
                              ┌─────────────────┐
                              │                 │
              ┌───────────────│    OCIOSO       │───────────────┐
              │               │  (Tela Bloqueada)               │
              │               └────────┬────────┘               │
              │                        │                        │
              │ Heartbeat              │ Usuário tenta          │ Heartbeat
              │ (a cada 30s)           │ fazer login            │ (shouldBlock=false)
              │                        ▼                        │
              │               ┌─────────────────┐               │
              │               │                 │               │
              │               │   VALIDANDO     │               │
              │               │   CREDENCIAIS   │               │
              │               │                 │               │
              │               └────────┬────────┘               │
              │                        │                        │
              │            ┌───────────┴───────────┐            │
              │            │                       │            │
              │     Válido + Alocação        Inválido ou        │
              │            │                 Sem Alocação       │
              │            ▼                       │            │
              │   ┌─────────────────┐              │            │
              │   │                 │              │            │
              └──>│     ATIVO       │<─────────────┘            │
                  │ (Sessão do User)│                           │
                  │                 │                           │
                  └────────┬────────┘                           │
                           │                                    │
                           │ Logout ou                          │
                           │ Fim da alocação                    │
                           │                                    │
                           └────────────────────────────────────┘
```

### 4.3 Ciclo de Heartbeat

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CICLO DE HEARTBEAT                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Intervalo: 30 segundos                                                 │
│                                                                          │
│  Dados enviados:                                                        │
│  {                                                                       │
│    "telemetry": {                                                       │
│      "cpuPercent": 45.2,                                                │
│      "ramPercent": 68.5,                                                │
│      "diskPercent": 52.0                                                │
│    }                                                                     │
│  }                                                                       │
│                                                                          │
│  Dados recebidos:                                                       │
│  {                                                                       │
│    "machineId": 1,                                                      │
│    "shouldBlock": false,          // Bloquear tela?                     │
│    "canQuickAllocate": true,      // Permitir alocação rápida?          │
│    "minutesUntilNext": 45,        // Minutos até próxima alocação       │
│    "currentAllocation": {         // Alocação ativa (se houver)         │
│      "id": 123,                                                         │
│      "userId": 5,                                                       │
│      "startsAt": "2026-02-02T10:00:00",                                │
│      "endsAt": "2026-02-02T11:00:00"                                   │
│    }                                                                     │
│  }                                                                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Front-end (Web)

### 5.1 Visão Geral

O front-end do sistema será uma aplicação web moderna, responsiva e intuitiva, desenvolvida para permitir que usuários e administradores interajam com o sistema de gerenciamento de laboratórios.

> **Nota**: A implementação do front-end está em fase de planejamento. As informações abaixo representam a visão geral das funcionalidades planejadas.

#### Tecnologias Consideradas

| Opção       | Descrição                                         |
| ----------- | ------------------------------------------------- |
| **React**   | Biblioteca para construção de interfaces reativas |
| **Vue.js**  | Framework progressivo para SPAs                   |
| **Next.js** | Framework React com SSR/SSG                       |
| **Nuxt.js** | Framework Vue com SSR/SSG                         |

#### Bibliotecas de Apoio (Planejadas)

- **UI Components**: Tailwind CSS, shadcn/ui ou Vuetify
- **Gerenciamento de Estado**: Zustand, Pinia ou Redux
- **Requisições HTTP**: Axios ou fetch nativo
- **Validação de Formulários**: Zod, Yup ou VeeValidate
- **Calendário**: FullCalendar ou similar

### 5.2 Funcionalidades Planejadas

#### Para Usuários Comuns

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FUNCIONALIDADES DO USUÁRIO                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  📅 Visualização de Disponibilidade                                     │
│     • Calendário interativo com slots disponíveis                       │
│     • Filtro por laboratório, data e horário                            │
│     • Indicadores visuais de ocupação                                   │
│                                                                          │
│  🖥️ Reserva de Máquinas                                                 │
│     • Seleção de máquina específica ou automática                       │
│     • Definição de período (início e fim)                               │
│     • Confirmação e cancelamento de reservas                            │
│                                                                          │
│  📊 Histórico e Métricas Pessoais                                       │
│     • Lista de reservas passadas e futuras                              │
│     • Estatísticas de uso (horas, frequência)                           │
│                                                                          │
│  👤 Perfil do Usuário                                                   │
│     • Atualização de dados pessoais                                     │
│     • Alteração de senha                                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Para Administradores

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FUNCIONALIDADES DO ADMINISTRADOR                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  🖥️ Gerenciamento de Máquinas                                           │
│     • Cadastro e edição de máquinas                                     │
│     • Visualização de status em tempo real                              │
│     • Histórico de manutenções                                          │
│                                                                          │
│  👥 Gerenciamento de Usuários                                           │
│     • Listagem e busca de usuários                                      │
│     • Criação e edição de contas                                        │
│     • Definição de permissões (admin/user)                              │
│                                                                          │
│  📊 Dashboard de Monitoramento                                          │
│     • Visão geral de todos os laboratórios                              │
│     • Métricas de utilização (CPU, RAM, Disco)                          │
│     • Gráficos de tendência de uso                                      │
│                                                                          │
│  📈 Relatórios                                                          │
│     • Relatório de ocupação por período                                 │
│     • Relatório de usuários mais ativos                                 │
│     • Exportação em PDF/CSV                                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Interfaces Principais

#### Wireframe - Tela de Login

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                        SISTEMA DE LABORATÓRIOS                           │
│                                                                          │
│                    ┌───────────────────────────┐                        │
│                    │                           │                        │
│                    │         🔐 LOGIN          │                        │
│                    │                           │                        │
│                    │  ┌─────────────────────┐  │                        │
│                    │  │ Email               │  │                        │
│                    │  └─────────────────────┘  │                        │
│                    │                           │                        │
│                    │  ┌─────────────────────┐  │                        │
│                    │  │ Senha          👁️   │  │                        │
│                    │  └─────────────────────┘  │                        │
│                    │                           │                        │
│                    │  ┌─────────────────────┐  │                        │
│                    │  │      ENTRAR         │  │                        │
│                    │  └─────────────────────┘  │                        │
│                    │                           │                        │
│                    │  Não tem conta? Registre  │                        │
│                    │                           │                        │
│                    └───────────────────────────┘                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe - Calendário de Reservas

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🏠 Home   📅 Reservas   🖥️ Máquinas   👤 Perfil         [Sair]        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ◀ Fevereiro 2026 ▶                           [Filtrar Laboratório ▼]  │
│                                                                          │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐                           │
│  │ DOM │ SEG │ TER │ QUA │ QUI │ SEX │ SAB │                           │
│  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤                           │
│  │  1  │  2  │  3  │  4  │  5  │  6  │  7  │                           │
│  │     │ ●●  │ ●   │ ●●● │     │ ●   │     │                           │
│  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤                           │
│  │  8  │  9  │ 10  │ 11  │ 12  │ 13  │ 14  │                           │
│  │     │ ●   │ ●●  │     │ ●●  │ ●●● │     │                           │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘                           │
│                                                                          │
│  ● = Suas reservas                                                      │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Dia selecionado: 02/02/2026                                       │  │
│  │                                                                    │  │
│  │  08:00 │ Lab 1 - PC-05 │ Reservado (Você)     │ [Cancelar]        │  │
│  │  10:00 │ Lab 2 - PC-12 │ Reservado (Você)     │ [Cancelar]        │  │
│  │                                                                    │  │
│  │                    [+ Nova Reserva]                                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe - Dashboard Administrativo

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🏠 Dashboard   👥 Usuários   🖥️ Máquinas   📊 Relatórios     [Admin]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   MÁQUINAS      │  │   USUÁRIOS      │  │   RESERVAS      │         │
│  │                 │  │                 │  │                 │         │
│  │   🖥️ 24        │  │   👥 156        │  │   📅 45         │         │
│  │   Online: 18    │  │   Ativos: 89    │  │   Hoje: 12      │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    USO MÉDIO DE RECURSOS                         │   │
│  │                                                                   │   │
│  │  CPU    ████████████████░░░░░░░░░░░░  45%                        │   │
│  │  RAM    ██████████████████████░░░░░░  62%                        │   │
│  │  DISCO  ████████████░░░░░░░░░░░░░░░░  35%                        │   │
│  │                                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  MÁQUINAS EM TEMPO REAL                               [Ver Todos]│   │
│  │                                                                   │   │
│  │  PC-01 🟢  CPU: 23%  RAM: 45%  │  PC-02 🟢  CPU: 67%  RAM: 78%  │   │
│  │  PC-03 🔴  Offline             │  PC-04 🟡  CPU: 89%  RAM: 92%  │   │
│  │  PC-05 🟢  CPU: 12%  RAM: 34%  │  PC-06 🟢  CPU: 45%  RAM: 56%  │   │
│  │                                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Considerações Finais

### Trabalhos Futuros

- **Notificações Push**: Alertas para início/fim de reservas
- **Integração LDAP/AD**: Autenticação com diretório da instituição
- **App Mobile**: Versão mobile para consulta e reservas
- **Machine Learning**: Previsão de demanda e sugestões de horários
- **Auditoria Avançada**: Log detalhado de eventos para compliance

### Conclusão

O Sistema de Gerenciamento de Laboratórios apresentado neste documento oferece uma solução completa para otimização do uso de recursos computacionais em ambientes acadêmicos. A arquitetura modular e bem documentada permite extensibilidade e manutenção facilitada.

---

_Documento gerado para o Trabalho de Conclusão de Curso_
_Data: Fevereiro de 2026_
