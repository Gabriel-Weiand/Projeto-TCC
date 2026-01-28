import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Lazy Loading Controllers
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const AgentController = () => import('#controllers/agent_controller')
const MachinesController = () => import('#controllers/machines_controller')
const AllocationsController = () => import('#controllers/allocations_controller')
const TelemetriesController = () => import('#controllers/telemetries_controller')
const AllocationMetricsController = () => import('#controllers/allocation_metrics_controller')
const SystemController = () => import('#controllers/system_controller')
const UtilsController = () => import('#controllers/utils_controller')

/**
 * Public Utils Routes (no auth required)
 */
router
  .group(() => {
    router.get('alive', [UtilsController, 'alive']).as('utils.alive')
  })
  .prefix('api')

/**
 * API v1 - Frontend Routes
 */
router
  .group(() => {
    // ========================================
    // PUBLIC ROUTES
    // ========================================
    router.post('login', [AuthController, 'login']).as('auth.login')

    // ========================================
    // AUTHENTICATED ROUTES
    // ========================================
    router
      .group(() => {
        // --- Auth & Profile ---
        router.delete('logout', [AuthController, 'logout']).as('auth.logout')
        router.get('me', [AuthController, 'me']).as('auth.me')

        // --- Users (Admin Only) ---
        router
          .group(() => {
            router.post('/', [UsersController, 'store']).as('users.store')
            router.get('/', [UsersController, 'index']).as('users.index')
            router.get('/:id', [UsersController, 'show']).as('users.show')
            router.delete('/:id', [UsersController, 'destroy']).as('users.destroy')
            router
              .get('/:id/allocations', [AllocationsController, 'userHistory'])
              .as('users.allocations')
          })
          .prefix('users')
          .where('id', router.matchers.number())
          .use(middleware.isAdmin()) // Admin Only

        // --- Users Update (General - each user updates their own) ---
        router
          .put('/users/:id', [UsersController, 'update'])
          .as('users.update')
          .where('id', router.matchers.number())

        // --- Machines (Admin Only - except GET list) ---
        router.get('/machines', [MachinesController, 'index']).as('machines.index') // Public

        router
          .group(() => {
            router.post('/', [MachinesController, 'store']).as('machines.store')
            router.get('/:id', [MachinesController, 'show']).as('machines.show')
            router.put('/:id', [MachinesController, 'update']).as('machines.update')
            router.delete('/:id', [MachinesController, 'destroy']).as('machines.destroy')
            router.get('/:id/telemetry', [MachinesController, 'telemetry']).as('machines.telemetry')
            router
              .post('/:id/regenerate-token', [MachinesController, 'regenerateToken'])
              .as('machines.regenerateToken')
          })
          .prefix('machines')
          .where('id', router.matchers.number())
          .use(middleware.isAdmin()) // Admin Only

        // --- Machines Allocations (General - anonimizado para users) ---
        router
          .get('/machines/:id/allocations', [AllocationsController, 'machineHistory'])
          .as('machines.allocations')
          .where('id', router.matchers.number())

        // --- Allocations (Mixed Permissions) ---
        router
          .group(() => {
            router.post('/', [AllocationsController, 'store']).as('allocations.store') // General
            router.get('/', [AllocationsController, 'index']).as('allocations.index') // General
            router.patch('/:id', [AllocationsController, 'update']).as('allocations.update') // General
            router
              .get('/:id/summary', [AllocationsController, 'getSessionSummary'])
              .as('allocations.summary.show') // General
          })
          .prefix('allocations')
          .where('id', router.matchers.number())

        // --- Allocations Summary (Admin Only) ---
        router
          .post('allocations/:id/summary', [AllocationsController, 'summarizeSession'])
          .as('allocations.summary.create')
          .where('id', router.matchers.number())
          .use(middleware.isAdmin()) // Admin Only

        // --- Maintenance (Admin Only) ---
        router
          .group(() => {
            router
              .delete('telemetries/:telemetryId', [TelemetriesController, 'destroy'])
              .as('maintenance.telemetry.destroy')
            router
              .delete('metrics/:metricId', [AllocationMetricsController, 'destroy'])
              .as('maintenance.metric.destroy')
          })
          .prefix('maintenance')
          .use(middleware.isAdmin()) // Admin Only

        // --- System Prune (Admin Only) ---
        router
          .group(() => {
            router
              .delete('telemetries', [SystemController, 'pruneTelemetries'])
              .as('system.prune.telemetries')
            router
              .delete('allocations', [SystemController, 'pruneAllocations'])
              .as('system.prune.allocations')
            router.delete('metrics', [SystemController, 'pruneMetrics']).as('system.prune.metrics')
          })
          .prefix('system/prune')
          .use(middleware.isAdmin()) // Admin Only
      })
      .use(middleware.auth())
  })
  .prefix('api/v1')

/**
 * API Agent - Machine Agent Routes
 * Todas as rotas requerem autenticação via token da máquina.
 */
router
  .group(() => {
    // --- Heartbeat & Status ---
    router.post('heartbeat', [AgentController, 'heartbeat']).as('agent.heartbeat')
    router.get('should-block', [AgentController, 'shouldBlock']).as('agent.shouldBlock')

    // --- Validação de Usuário ---
    router.post('validate-user', [AgentController, 'validateUser']).as('agent.validateUser')

    // --- Alocações ---
    router.get('allocations', [AgentController, 'allocations']).as('agent.allocations')
    router.get('current-session', [AgentController, 'currentSession']).as('agent.currentSession')

    // --- Reports de Login/Logout no SO ---
    router.post('report-login', [AgentController, 'reportLogin']).as('agent.reportLogin')
    router.post('report-logout', [AgentController, 'reportLogout']).as('agent.reportLogout')

    // --- Sync & Telemetria ---
    router.put('sync-specs', [AgentController, 'syncSpecs']).as('agent.syncSpecs')
    router.post('telemetry', [AgentController, 'telemetry']).as('agent.telemetry')
  })
  .prefix('api/agent')
  .use(middleware.machineAuth())
