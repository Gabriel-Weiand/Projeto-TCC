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

        // --- Users ---
        router
          .group(() => {
            router.post('/', [UsersController, 'store']).as('users.store')
            router.get('/', [UsersController, 'index']).as('users.index')
            router.get('/:id', [UsersController, 'show']).as('users.show')
            router.put('/:id', [UsersController, 'update']).as('users.update')
            router.delete('/:id', [UsersController, 'destroy']).as('users.destroy')
            router
              .get('/:id/allocations', [AllocationsController, 'userHistory'])
              .as('users.allocations')
          })
          .prefix('users')
          .where('id', router.matchers.number()) // Returns 404 if :id is not a number

        // --- Machines ---
        router
          .group(() => {
            router.post('/', [MachinesController, 'store']).as('machines.store')
            router.get('/', [MachinesController, 'index']).as('machines.index')
            router.get('/:id', [MachinesController, 'show']).as('machines.show')
            router.delete('/:id', [MachinesController, 'destroy']).as('machines.destroy')
            router.get('/:id/telemetry', [MachinesController, 'telemetry']).as('machines.telemetry')
            router
              .get('/:id/allocations', [AllocationsController, 'machineHistory'])
              .as('machines.allocations')
          })
          .prefix('machines')
          .where('id', router.matchers.number())

        // --- Allocations ---
        router
          .group(() => {
            router.post('/', [AllocationsController, 'store']).as('allocations.store')
            router.get('/', [AllocationsController, 'index']).as('allocations.index')
            router.patch('/:id', [AllocationsController, 'update']).as('allocations.update')
            router
              .post('/:id/summary', [AllocationsController, 'summarizeSession'])
              .as('allocations.summary.create')
            router
              .get('/:id/summary', [AllocationsController, 'getSessionSummary'])
              .as('allocations.summary.show')
          })
          .prefix('allocations')
          .where('id', router.matchers.number())

        // --- Maintenance (Individual Operations) ---
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

        // --- System Prune (Bulk Operations) ---
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
      })
      .use(middleware.auth())
  })
  .prefix('api/v1')

/**
 * API Agent - Machine Agent Routes
 */
router
  .group(() => {
    router.post('validate-access', [AgentController, 'validateAccess']).as('agent.validate')

    router.post('telemetry', [AgentController, 'report']).as('agent.telemetry')
  })
  .prefix('api/agent')
  .use(middleware.machineAuth())
