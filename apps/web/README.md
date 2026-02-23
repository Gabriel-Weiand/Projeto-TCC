# Frontend Web — Sistema de Laboratórios

Interface web para gerenciamento de reservas de máquinas de laboratório.

**Stack:** Vue 3 + TypeScript + Vite + Pinia + Vue Router + Axios

---

## Pré-requisitos

| Ferramenta | Versão |
| ---------- | ------ |
| Node.js    | 18+    |
| npm        | 9+     |

O servidor da API (`apps/api`) precisa estar rodando para o frontend funcionar.

---

## Instalação e execução

```bash
cd apps/web

# Instalar dependências
npm install

# Configurar URL do servidor (edite se necessário)
# Padrão: http://localhost:3333
echo "VITE_API_URL=http://localhost:3333" > .env

# Iniciar em modo desenvolvimento
npm run dev
```

O frontend sobe em `http://localhost:5173`.

Para acessar de outra máquina na rede local, o Vite já está configurado com `host: true`, então use `http://<IP-DA-MÁQUINA>:5173`.

---

## Configuração do servidor API (primeiro uso)

Se é a primeira vez, prepare o servidor:

```bash
cd apps/api

npm install

# Criar banco e tabelas
node ace migration:run

# Popular com dados de teste
node ace db:seed

# Iniciar servidor
node ace serve --watch
```

O seed cria os seguintes usuários de teste:

| Email                       | Senha    | Papel |
| --------------------------- | -------- | ----- |
| admin@lab.ufpel.edu.br      | admin123 | admin |
| silva@lab.ufpel.edu.br      | prof1234 | admin |
| gabriel.santos@ufpel.edu.br | aluno123 | user  |
| maria.oliveira@ufpel.edu.br | aluno123 | user  |
| joao.pereira@ufpel.edu.br   | aluno123 | user  |

E 6 máquinas (PC-LAB-01 a PC-LAB-06) com specs variadas.

---

## Fluxo de uso

### 1. Login

Acesse `http://localhost:5173`. A tela de login aparece automaticamente.

Use qualquer credencial da tabela acima (ex: `gabriel.santos@ufpel.edu.br` / `aluno123`).

O token JWT é salvo no `localStorage` e enviado automaticamente em todas as requisições. Se o token expirar, o sistema redireciona para o login.

### 2. Hub de Reservas (Home)

Após o login, a página principal exibe:

- **Calendário mensal** — navegue entre meses com ◄ ►
  - Pontos azuis = suas reservas
  - Pontos cinza = reservas de outros
- **Filtro de máquina** — filtre o calendário e a lista por máquina
- **Detalhe do dia** — clique em um dia para ver todas as reservas
  - Horário, máquina, quem reservou, status
  - Botão "Cancelar" nas suas reservas ativas

### 3. Criar uma reserva

1. Selecione um dia no calendário
2. Clique em **"+ Nova Reserva"**
3. Escolha a máquina, horário de início/fim e motivo (opcional)
4. Clique em **"Reservar"**

Se houver conflito de horário, o sistema avisa. O servidor exige um intervalo mínimo de 5 minutos entre reservas na mesma máquina.

### 4. Cancelar uma reserva

Na lista de reservas do dia, clique em **"Cancelar"** ao lado da sua reserva. Apenas reservas com status "Aprovada" podem ser canceladas.

### 5. Ver máquinas

A página **Máquinas** lista todas as máquinas do laboratório com:

- Status atual (🟢 Disponível / 🔴 Ocupada / 🟡 Manutenção / ⚫ Offline)
- Specs de hardware (CPU, GPU, RAM, Disco)
- Usuário logado (quando o agente reporta)

### 6. Perfil

Exibe nome, email e papel (Usuário/Administrador) do usuário logado.

---

## Teste em rede local (2 máquinas)

```
PC-SERVIDOR (192.168.1.10)         PC-ALUNO (192.168.1.20)
┌──────────────────────────┐       ┌──────────────────────────┐
│  apps/api                │       │  Navegador               │
│  node ace serve --watch  │◄─────►│  http://192.168.1.10:5173│
│  :3333                   │       │                          │
│                          │       └──────────────────────────┘
│  apps/web                │
│  npm run dev             │
│  :5173 (host: true)      │
└──────────────────────────┘
```

1. **No PC-Servidor:**

   ```bash
   # Terminal 1 — API
   cd apps/api && node ace serve --watch

   # Terminal 2 — Frontend
   cd apps/web
   echo "VITE_API_URL=http://192.168.1.10:3333" > .env
   npm run dev
   ```

2. **No PC-Aluno:** abra o navegador em `http://192.168.1.10:5173`

3. Faça login com `gabriel.santos@ufpel.edu.br` / `aluno123`

---

## Estrutura de pastas

```
apps/web/
├── index.html
├── package.json
├── vite.config.ts
├── .env                        # VITE_API_URL
├── tsconfig.json
├── src/
│   ├── main.ts                 # Entry point (Pinia + Router)
│   ├── App.vue                 # Root component (<RouterView>)
│   ├── env.d.ts                # Tipos do import.meta.env
│   ├── assets/
│   │   └── main.css            # CSS global (tema escuro)
│   ├── types/
│   │   └── index.ts            # Interfaces (User, Machine, Allocation)
│   ├── services/
│   │   └── api.ts              # Axios instance + interceptors
│   ├── stores/
│   │   ├── auth.ts             # Pinia store: login, logout, token
│   │   ├── allocations.ts      # Pinia store: CRUD de reservas
│   │   └── machines.ts         # Pinia store: listagem de máquinas
│   ├── router/
│   │   └── index.ts            # Vue Router: login, home, machines, profile
│   ├── layouts/
│   │   └── AppLayout.vue       # Navbar + <RouterView>
│   ├── views/
│   │   ├── LoginView.vue       # Tela de login
│   │   ├── HomeView.vue        # Hub com calendário + reservas
│   │   ├── MachinesView.vue    # Lista de máquinas
│   │   └── ProfileView.vue     # Perfil do usuário
│   └── components/
│       └── NewAllocationModal.vue  # Modal para criar reserva
└── README.md
```

---

## Scripts disponíveis

| Comando           | Descrição                          |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Inicia servidor de desenvolvimento |
| `npm run build`   | Build de produção em `dist/`       |
| `npm run preview` | Serve o build de produção          |
