# Frontend Web

Interface Vue 3 do sistema de laboratórios. Documentação técnica completa: [`MODULE.md`](MODULE.md).

**Stack:** Vue 3 · TypeScript · Vite · Pinia · Axios · Chart.js  
**Node.js:** 22.x (mesma versão da API)

---

## Início rápido

```bash
cd apps/web
npm install
echo "VITE_API_URL=http://localhost:3333" > .env
npm run dev
```

API em execução (`apps/api`, porta 3333). Front: `http://localhost:5173`.

---

## Primeiro uso (API + seed)

```bash
cd apps/api
npm install && cp .env.example .env
node ace migration:fresh --seed
node ace serve --watch
```

Usuários de teste (seed):

| Email | Senha | Papel |
|-------|-------|-------|
| admin@lab.ufpel.edu.br | admin123 | admin |
| gabriel.santos@ufpel.edu.br | aluno123 | user |

---

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Desenvolvimento (HMR) |
| `npm run build` | Build produção |
| `npm run preview` | Preview do build |

---

## Rede local

O Vite usa `host: true` — acesse de outra máquina com `http://<IP>:5173` e `VITE_API_URL` apontando para a API.
