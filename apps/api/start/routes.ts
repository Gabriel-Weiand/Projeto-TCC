import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Importação Preguiçosa dos Controllers (Melhor performance)
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const MachinesController = () => import('#controllers/machines_controller')
const AllocationsController = () => import('#controllers/allocations_controller')
const AgentController = () => import('#controllers/agent_controller')

router
  .group(() => {
    //Rotas do frontend
    // ---ROTAS PÚBLICAS---

    router.post('login', [AuthController, 'login']).as('auth.login') // (Aberto)

    // ---ROTAS PROTEGIDAS(Precisa de Token)---
    router
      .group(() => {
        // Perfil do usuário
        router.delete('logout', [AuthController, 'logout']).as('auth.logout') // (Geral)

        router.get('me', [AuthController, 'me']).as('auth.get_infos') // (Geral)

        // Users (Gestão de usuários)
        router.post('users', [UsersController, 'store']).as('users.register') // (Admin)

        router.get('users', [UsersController, 'index']).as('users.list_all') //(Admin)

        router.get('users/:id', [UsersController, 'show']).as('users.get_details') //(Admin)

        router
          .get('users/:id/allocations', [AllocationsController, 'userHistory'])
          .as('users.list_allocations_history') // Histórico de alocação de um usuário (Admin - Qualquer usuário, User - Próprio)

        router.put('users/:id', [UsersController, 'update']).as('users.update_profile') //(Geral)

        router.delete('users/:id', [UsersController, 'destroy']).as('users.delete_account') //(Admin)

        // Máquinas
        router.post('machines', [MachinesController, 'store']).as('machines.register_new') // Cadastrar nova máquina (Admin)

        router.get('machines', [MachinesController, 'index']).as('machines.list_inventory') // Listar inventário (Geral)

        router.delete('machines/:id', [MachinesController, 'destroy']).as('machines.remove_device') // Remover dispositivo (Admin)

        router
          .get('machines/:id/telemetry', [MachinesController, 'telemetry'])
          .as('machines.view_telemetry_history') // Ver histórico visual (Admin)

        router.get('machines/:id', [MachinesController, 'show']).as('machines.get_details') // Detalhes da máquina (Admin)

        // Allocations (Reservas)
        router
          .get('machines/:id/allocations', [AllocationsController, 'machineHistory'])
          .as('machines.list_allocations_history') // Listar reservas futuras de uma máquina específica (Geral)

        router
          .post('allocations', [AllocationsController, 'store'])
          .as('allocations.request_access') // Solicitar acesso (Geral)

        router.get('allocations', [AllocationsController, 'index']).as('allocations.list_history') // Listar histórico (Admin - geral, User - próprio)

        router
          .patch('allocations/:id', [AllocationsController, 'update'])
          .as('allocations.change_status') // Alterar status da reserva (Admin)
      })
      .use(middleware.auth())
  })
  .prefix('api/v1')

router
  .group(() => {
    //Rotas da API dos Agentes de Máquina

    // Validação de Acesso (Login Local na Máquina)
    // Payload esperado: { email, password } + API key
    router
      .post('validate-access', [AgentController, 'validateAccess'])
      .as('agent.validate_user_credentials')
    // Nome claro: O agente está validando as credenciais de um humano

    // Telemetria (Reportar Estado)
    // Payload esperado: { cpu_percent, ram_percent, gpu_percent, uptime_seconds }
    router.post('telemetry', [AgentController, 'report']).as('agent.push_metrics')
  })
  .prefix('api/agent')
// .use(middleware.machineAuth()) -> Futuro middleware de API Key
