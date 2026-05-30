# Módulo Web

## Papel

Aplicação SPA para alunos e administradores. A interface centraliza reservas, consulta de máquinas, e exibição de métricas de uso.

## Comunicação com a API

- **Autenticação**: login em `/api/v1/login`, token salvo localmente e enviado em todas as requisições.
- **Reservas**: CRUD de alocações, com validação de conflitos e estados (pending/approved/denied).
- **Máquinas**: listagem, detalhe, telemetria recente e histórico consolidado.
- **Notificações**: consumo de inbox para aprovações, recusas e manutenção.
- **SSH**: cadastro da chave pública do usuário e instruções de conexão quando há alocação ativa.

## Estado local

- Stores (Pinia) para sessão do usuário, reservas e máquinas.
- Sincronização de tempo com a API para evitar divergência de relógio no navegador.

## Saídas

- Interface para usuários finais (reserva, acompanhamento de sessão, conexão SSH).
- Painel admin para gerenciar parque de máquinas e auditoria.

---

## Planejamento (migrado do README geral)

> **Nota**: A implementação do front-end está em fase de planejamento. As informações abaixo representam a visão geral das funcionalidades planejadas.

### Tecnologias Consideradas

| Opção       | Descrição                                         |
| ----------- | ------------------------------------------------- |
| **React**   | Biblioteca para construção de interfaces reativas |
| **Vue.js**  | Framework progressivo para SPAs                   |
| **Next.js** | Framework React com SSR/SSG                       |
| **Nuxt.js** | Framework Vue com SSR/SSG                         |

### Bibliotecas de Apoio (Planejadas)

- **UI Components**: Tailwind CSS, shadcn/ui ou Vuetify
- **Gerenciamento de Estado**: Zustand, Pinia ou Redux
- **Requisições HTTP**: Axios ou fetch nativo
- **Validação de Formulários**: Zod, Yup ou VeeValidate
- **Calendário**: FullCalendar ou similar

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
│  │                                                                   │
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
