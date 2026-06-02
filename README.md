# Sistema Distribuído de Gestão de Laboratórios

Este projeto é parte fundamental do Trabalho de Conclusão de Curso (TCC) na Universidade Federal de Pelotas (UFPel). Ele tem como objetivo abranger uma solução completa para o gerenciamento de alocação, monitoramento e controle de acesso em máquinas de laboratórios universitários de pesquisa. O sistema opera em uma arquitetura distribuída composta por uma API central, um dashboard/site web para alocações e agentes locais instalados nas máquinas.

---

## 📑 Sumário

1. [Contexto e Solução](#-contexto-e-solução)
2. [Arquitetura do Sistema](#-arquitetura-do-sistema)

- [Visão Geral](#visão-geral)

3. [Funcionalidades (MVP)](#-funcionalidades-mvp)
4. [Status do Projeto](#-status-do-projeto)
5. [Documentação por Módulo](#-documentação-por-módulo)
6. [Estrutura do Projeto](#-estrutura-do-projeto)
7. [Como Rodar (visão geral)](#-como-rodar-visão-geral)
8. [Trabalhos Futuros](#-trabalhos-futuros)
9. [Licença](#-licença)

---

## 🎯 Contexto e Solução

Atualmente, a gestão de recursos computacionais em alguns laboratórios de pesquisa depende de planilhas e comunicação informal, o que compromete a eficiência e a segurança dos computadores/servidores.

A solução foi projetada sob a ótica de **Sistemas Distribuídos**, visando garantir a convergência entre:

1. **Estado Desejado:** O agendamento definido no sistema web.
2. **Estado Real:** O comportamento efetivo da máquina física no laboratório.

### Objetivos do Sistema

- **Gerenciamento de Reservas**: Permitir que usuários reservem máquinas para períodos específicos
- **Controle de Acesso**: Validar credenciais e bloquear a conexão máquinas não reservadas
- **Monitoramento**: Coletar telemetria de uso (CPU, memória, disco)
- **Otimização de Recursos**: Fornecer dados para análise de utilização dos laboratórios

---

## 🏛 Arquitetura do Sistema

O projeto adota uma estrutura de **Monorepo** organizada, onde a API Central orquestra as regras de negócio para dois clientes distintos. A arquitetura foca na separação de responsabilidades de autenticação:

1. **Backend (API Central):** Desenvolvido em **AdonisJS 6**, atua como a fonte da verdade. Gerencia duas frentes de autenticação:
   - _Usuários:_ Autenticação via tokens (JWT-like) com hash SHA-256
   - _Agentes:_ Autenticação via Agent Keys (Bearer Token) de 512 bits
2. **Frontend (Web):** Interface para alunos solicitarem uso e administradores gerenciarem o parque.
3. **Agent (Máquinas Gerenciadas):** Software local (Daemon) que consulta a API para saber se deve permitir o uso ao hardware e reporta telemetria. Roda na rede local em que a API central está localizada.

### Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SISTEMA DE LABORATÓRIOS                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│   │              │     │              │     │                      │    │
│   │   FRONT-END  │────▶│     API      │◀────│   AGENTES DE         │    │
│   │   (Web App)  │     │   (AdonisJS) │     │   MÁQUINA            │    │
│   │              │     │              │     │                      │    │
│   └──────────────┘     └──────┬───────┘     └──────────────────────┘    │
│                               │                                         │
│                               ▼                                         │
│                        ┌──────────────┐                                 │
│                        │   DATABASE   │                                 │
│                        │   (SQLite)   │                                 │
│                        └──────────────┘                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Funcionalidades (MVP)

### 👤 Usuários & Acesso

- **Autenticação Híbrida:** Login tradicional para usuários e "Handshake" seguro para os agentes instalados.
- **Role-Based Access Control (RBAC):** Diferenciação estrita entre `Student` e `Admin`.
- **Senhas Criptografadas:** Senhas armazenadas com hash seguro (scrypt), nunca em texto plano.

### 📅 Alocação de Recursos (Modelo Otimista)

- **Aprovação Automática:** Visando agilidade no MVP, solicitações de alunos autenticados nascem com status `APPROVED`. Com exceção a solicitações com status Sudo.
- **Controle Reativo:** O Administrador monitora alocações ativas e pode alterá-las para `DENIED` ou `APPROVED` dependendo da alocação. Isso aciona o bloqueio imediato na máquina física via Agente.
- **Privacidade:** Alunos veem a ocupação do laboratório (mapa de máquinas), mas os dados de _quem_ está usando podem ou não ser anonimizados para não-admins (configurável).

### 🖥️ Gestão de Ativos & Telemetria

- **Sincronização de Estado:** O Agente consulta periodicamente ("Heartbeat") a API para alinhar o estado local (Bloqueado/Liberado).
- **Auditoria de Hardware:** Coleta de métricas (CPU/RAM) para identificar uso indevido ou máquinas ociosas.
- **Soft Deletes:** Preservação de histórico para auditoria.

---

## 🛠 Tecnologias Utilizadas

| Tecnologia     | Versão | Propósito                            |
| -------------- | ------ | ------------------------------------ |
| **Node.js**    | 20+    | Runtime JavaScript                   |
| **AdonisJS**   | 6.x    | Framework web full-stack             |
| **TypeScript** | 5.x    | Tipagem estática                     |
| **Lucid ORM**  | -      | Mapeamento objeto-relacional         |
| **VineJS**     | -      | Validação de dados                   |
| **SQLite**     | 3.x    | Banco de dados (WAL Mode habilitado) |

---

## 🔐 Segurança

### Criptografia de Senhas

As senhas dos usuários **nunca são armazenadas em texto plano** no banco de dados. O sistema utiliza o algoritmo **scrypt** para hash de senhas, um dos mais seguros disponíveis atualmente.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ARMAZENAMENTO SEGURO DE SENHAS                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  📥 CADASTRO/ATUALIZAÇÃO DE SENHA                                       │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  Senha: "minhasenha123"                                            │ │
│  │           │                                                        │ │
│  │           ▼                                                        │ │
│  │  ┌─────────────────┐                                               │ │
│  │  │  Algoritmo      │  • scrypt (padrão AdonisJS)                   │ │
│  │  │  de Hashing     │  • Resistente a ataques de GPU                │ │
│  │  │  (scrypt)       │  • Salt aleatório por senha                   │ │
│  │  └────────┬────────┘                                               │ │
│  │           │                                                        │ │
│  │           ▼                                                        │ │
│  │  Hash: "$scrypt$n=16384,r=8,p=1$salt$hash..."                      │ │
│  │  (armazenado no banco de dados)                                    │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  📤 VERIFICAÇÃO DE LOGIN                                                │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  1. Usuário envia: email + senha em texto plano (via HTTPS)        │ │
│  │  2. API busca o hash armazenado pelo email                         │ │
│  │  3. Aplica o mesmo algoritmo na senha enviada                      │ │
│  │  4. Compara os hashes (timing-safe comparison)                     │ │
│  │  5. Se igual → Login autorizado                                    │ │
│  │     Se diferente → Credenciais inválidas                           │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ⚠️  IMPORTANTE:                                                        │
│  • Mesmo administradores não conseguem ver a senha original             │
│  • Não existe "recuperar senha", apenas "redefinir"                     │
│  • Cada senha tem seu próprio salt único                                │
│  • O hash inclui os parâmetros do algoritmo para futuras migrações      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Características do scrypt:**

- **Resistente a ataques de força bruta**: Requer muita memória para computar
- **Salt único por senha**: Mesmo senhas iguais geram hashes diferentes
- **Timing-safe comparison**: Previne ataques de timing
- **Parâmetros ajustáveis**: Pode aumentar a dificuldade conforme hardware evolui

### Autenticação de Usuários

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUXO DE AUTENTICAÇÃO                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Login: POST /api/auth/login                             │
│     Body: { email, password }                               │
│     → Senha verificada contra hash no banco                 │
│     Response: { token, user }                               │
│                                                             │
│  2. Requisições autenticadas:                               │
│     Header: Authorization: Bearer <token>                   │
│     → Token validado (hash SHA-256 comparado)               │
│                                                             │
│  3. Logout: DELETE /api/auth/logout                         │
│     → Token invalidado (removido do banco)                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Autenticação de Máquinas

```
┌─────────────────────────────────────────────────────────────┐
│                   AUTENTICAÇÃO DE MÁQUINAS                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  • Objetivo é nesta fase é garantir que uma máquina não     │
│  possa se passar por outra.                                 │
│  • Cada máquina possui um Agent Key único de 512 bits       │
│  • Headers: Authorization: Bearer <token>                   │
│  • Cache de 5 minutos para reduzir consultas ao banco       │
│  • Usado apenas nas rotas /api/v1/agent/*                   │
│                                                             │
│  Geração do Agent Key:                                      │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ const apiKey = string.generateRandom(64) // 512 bits   │ │
│  │ // Exemplo: "d08248929bf8bcae92a2e204219c7941..."      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Rotação de Token:                                          │
│  • Admin pode regenerar token se comprometido               │
│  • POST /api/v1/machines/:id/regenerate-token               │
│  • Agente deve ser reconfigurado com novo token             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Regras de Negócio

### Regra de Gap entre Alocações

````
┌─────────────────────────────────────────────────────────────────────────┐
│                      REGRA DE 5 MINUTOS DE GAP                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Objetivo: Garantir tempo para troca de usuários entre sessões          │
│                                                                         │
│  Implementação:                                                         │
│  • Ao criar alocação, verificar conflito com gap de 5 minutos           │
│  • Alocação A (10:00-11:00) bloqueia criação de B antes de 11:05        │
│                                                                         │
│  Linha do tempo:                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 10:00      11:00  11:05      12:00                               │   │
│  │   │──────────│      │──────────│                                 │   │
│  │   │ Alocação │ GAP  │ Alocação │                                 │   │
│  │   │    A     │ 5min │    B     │                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

### 3. Configuração do Agente

#### Processo de Setup

1. **Admin cria máquina** via `POST /api/v1/machines` ou interface web
2. **Admin copia o token** retornado na criação (ou via `GET /api/v1/machines/:id`)
3. **Admin instala o agente** na máquina física
4. **Admin configura o token** no arquivo de config do agente
5. **Agente inicia** e faz `PUT /sync-specs` + `POST /heartbeat`
6. **Máquina fica online** e pronta para uso

#### Rotação de Token (Segurança)

Se o token for comprometido:

```http
POST /api/v1/machines/1/regenerate-token
Authorization: Bearer <ADMIN_USER_TOKEN>
````

Resposta:

```json
{
  "message": "Token regenerado com sucesso. Configure o agente com o novo token.",
  "machineId": 1,
  "token": "novo_token_aqui...",
  "tokenRotatedAt": "2026-01-28T12:00:00.000Z"
}
```

O admin deve então atualizar o config do agente na máquina física.

---

## 🤖 Agente de Máquina

### Responsabilidades

O agente de máquina é um software instalado em cada computador do laboratório, responsável por:

- **Comunicação**: Manter conexão com a API central via heartbeats periódicos
- **Autenticação Local**: Interceptar tentativas de login e validar permissões
- **Bloqueio de Tela**: Bloquear acesso quando não há alocação ativa
- **Coleta de Métricas**: Monitorar uso de CPU, memória e disco
- **Sincronização**: Reportar especificações de hardware

### Diagrama de Estados

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

## 💻 Front-end (Web)

> **Nota**: A implementação do front-end está em fase de execução.

### Tecnologias Consideradas

"dependencies": {
"axios": "^1.13.5",
"pinia": "^3.0.4",
"vue": "^3.5.25",
"vue-router": "^4.6.4"
},
"devDependencies": {
"@types/node": "^24.10.1",
"@vitejs/plugin-vue": "^6.0.2",
"@vue/tsconfig": "^0.9.1",
"typescript": "^6.0.3",
"vite": "^7.3.1",
"vue-tsc": "^3.2.8"

### Funcionalidades Planejadas

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

### Interfaces Principais (Wireframes)

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

## 📁 Estrutura base do Projeto

```
Projeto-TCC/
├── apps/
│   ├── api/         # Backend AdonisJS
│   ├── agent/       # Agente de máquina python (rodando como serviço)
│   └── web/         # Frontend Vue.js
├── packages/
│   └── shared/                   # Código compartilhado
├── docs/                         # Documentação
└── README.md
```

---

## 📦 Como Rodar

### Pré-requisitos

- Node.js 22 (recomendado; veja `.nvmrc` na raiz — `nvm use`)
- npm

Use **o mesmo Node** no terminal, no IDE e nos testes. O `better-sqlite3` é módulo nativo: se você trocar de versão do Node (ex.: Node do sistema vs Node do Cursor), a API pode falhar até recompilar. O `postinstall` em `apps/api` faz `npm rebuild better-sqlite3` automaticamente após cada `npm install` nessa pasta.

### Instalação

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/Projeto-TCC.git
cd Projeto-TCC
nvm use   # opcional, se usar nvm

# API — dependências e rebuild do SQLite (postinstall)
cd apps/api
npm install

# Configure o ambiente
cp .env.example .env
# Ajuste TZ para o fuso do laboratório (ex.: America/Sao_Paulo).
# Opcional: limites do calendário, validade do token, nomes públicos no Gantt
# (LAB_ALLOCATION_PUBLIC_NAMES=true — ver LAB_* em .env.example).

# Execute as migrations (dev: se o schema mudou, use fresh + seed)
node ace migration:run
# node ace migration:fresh --seed

# (Opcional) Execute os seeders para dados de teste
node ace db:seed

# Inicie o servidor de desenvolvimento
node ace serve --watch
```

### Front (Vue)

```bash
cd apps/web
npm install
npm run dev
```

### Testes

```bash
cd apps/api
node ace test
```

Se aparecer erro de ABI do `better-sqlite3`, confira `node -v` (deve ser 20–22) e rode de novo `npm install` em `apps/api`.

---

## 🔮 Trabalhos Futuros

- **Notificações Push**: Alertas para início/fim de reservas
- **Integração LDAP/AD**: Autenticação com diretório da instituição
- **App Mobile**: Versão mobile para consulta e reservas
- **Machine Learning**: Previsão de demanda e sugestões de horários
- **Auditoria Avançada**: Log detalhado de eventos para compliance
- **WebSocket**: Atualização em tempo real do status das máquinas

---

## 📄 Licença

Este projeto foi desenvolvido como parte do Trabalho de Conclusão de Curso (TCC) na Universidade Federal de Pelotas (UFPel).

---

_Documento atualizado em: Fevereiro de 2026_
