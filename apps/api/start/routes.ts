import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Importação Preguiçosa dos Controllers (Melhor performance)
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const AgentController = () => import('#controllers/agent_controller')
const MachinesController = () => import('#controllers/machines_controller')
const AllocationsController = () => import('#controllers/allocations_controller')
const TelemetriesController = () => import('#controllers/telemetries_controller')
const AllocationMetricsController = () => import('#controllers/allocation_metrics_controller')
const SystemController = () => import('#controllers/system_controller')

router
  .group(() => {
    //Rotas do frontend

    // ---ROTA PÚBLICA---
    router.post('login', [AuthController, 'login']).as('auth.login') // (Aberto)

    // ---ROTAS PROTEGIDAS(Precisa de Token)---
    router
      .group(() => {
        // --- GRUPO: AUTH & PERFIL ---
        router.group(() => {
          router.delete('logout', [AuthController, 'logout']).as('auth.logout') // (Geral)

          router.get('me', [AuthController, 'me']).as('auth.get_infos') // (Geral)
        })

        // --- GRUPO: USERS ---
        router
          .group(() => {
            router.post('/', [UsersController, 'store']).as('users.register') // (Admin) - Criação

            router.get('/', [UsersController, 'index']).as('users.list_all') // (Admin) - Listagem

            router.get('/:id', [UsersController, 'show']).as('users.get_details') // (Admin) - Detalhes

            router.put('/:id', [UsersController, 'update']).as('users.update_profile') // (Geral) - Edição

            router.delete('/:id', [UsersController, 'destroy']).as('users.delete_account') // (Admin) - Exclusão

            router
              .get('/:id/allocations', [AllocationsController, 'userHistory'])
              .as('users.list_allocations_history') // Histórico de alocação de um usuário (Admin - Qualquer usuário, User - Próprio)
          })
          .prefix('users')

        // --- GRUPO: MACHINES ---
        router
          .group(() => {
            router.post('/', [MachinesController, 'store']).as('machines.register_new') // Cadastrar nova máquina (Admin)

            router.get('/', [MachinesController, 'index']).as('machines.list_inventory') // Listar inventário (Geral)

            router.get('/:id', [MachinesController, 'show']).as('machines.get_details') // Detalhes da máquina (Admin)

            router.delete('/:id', [MachinesController, 'destroy']).as('machines.remove_device') // Remover dispositivo (Admin)

            router
              .get('/:id/telemetry', [MachinesController, 'telemetry'])
              .as('machines.view_telemetry_history') // Ver histórico de telemetria de uma maquina (Admin)

            router
              .get('/:id/allocations', [AllocationsController, 'machineHistory'])
              .as('machines.list_allocations_history') // Listar reservas futuras de uma máquina específica (Geral)
          })
          .prefix('machines')

        // --- GRUPO: ALLOCATIONS ---
        router
          .group(() => {
            router.post('/', [AllocationsController, 'store']).as('allocations.request_access') // Solicitar acesso (Geral)

            router.get('/', [AllocationsController, 'index']).as('allocations.list_history') // Listar histórico (Admin - geral, User - próprio)

            router.patch('/:id', [AllocationsController, 'update']).as('allocations.change_status') // Alterar status da reserva (Admin - geral, User - próprio)

            router
              .post('/:id/summary', [AllocationsController, 'summarizeSession'])
              .as('allocations.create_session_summary') // Gerar resumo da sessão (Admin)

            router
              .get('/:id/summary', [AllocationsController, 'getSessionSummary'])
              .as('allocations.view_session_summary') // Ver resumo da sessão (Geral)
          })
          .prefix('allocations')

        // --- EXCLUSÃO DE DADOS ---
        router.group(() => {
          // Manutenção pontual
          router
            .delete('telemetries/:id', [TelemetriesController, 'destroy'])
            .as('telemetries.delete') // Deletar um registro específico de telemetria

          router
            .delete('allocation-metrics/:id', [AllocationMetricsController, 'destroy'])
            .as('allocation_metrics.delete') // Deletar um resumo específico

          // Prune do sistema (Limpeza em massa)
          router
            .group(() => {
              router
                .delete('telemetries', [SystemController, 'pruneTelemetries'])
                .as('system.prune.telemetries') // Apaga dados brutos (Telemetries)

              router
                .delete('allocations', [SystemController, 'pruneAllocations'])
                .as('system.prune.allocations') // Apaga alocações inteiras (Cascata: Alocação + Métricas (Telemetries ou Allocation Metrics))

              router
                .delete('allocation-metrics', [SystemController, 'pruneMetrics'])
                .as('system.prune.metrics') // Apaga resumos (Allocation Metrics)
            })
            .prefix('system/prune')
        }) // (Admin)
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
  .use(middleware.machineAuth())
