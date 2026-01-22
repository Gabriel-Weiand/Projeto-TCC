import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Importação Preguiçosa dos Controllers (Melhor performance)
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')

router
  .group(() => {
    // --- ROTAS PÚBLICAS (Qualquer um acessa) ---
    router.post('users', [UsersController, 'store']) // Cadastro
    router.post('login', [AuthController, 'login']) // Login

    // --- ROTAS PROTEGIDAS (Precisa do Token) ---
    router
      .group(() => {
        // Auth
        router.delete('logout', [AuthController, 'logout'])
        router.get('me', [AuthController, 'me'])

        // Users (Gestão)
        router.get('users', [UsersController, 'index']) // Listar (Admin)
        router.get('users/:id', [UsersController, 'show']) // Ver detalhe
        router.put('users/:id', [UsersController, 'update']) // Editar
        router.delete('users/:id', [UsersController, 'destroy']) // Excluir
      })
      .use(middleware.auth()) // <--- AQUI ESTÁ A PROTEÇÃO
  })
  .prefix('api/v1')
