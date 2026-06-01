import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Lazy Loading Controllers
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const AgentController = () => import('#controllers/agent_controller')
const MachinesController = () => import('#controllers/machines_controller')
const MachineGroupsController = () => import('#controllers/machine_groups_controller') // NOVO
const AllocationsController = () => import('#controllers/allocations_controller')
const TelemetriesController = () => import('#controllers/telemetries_controller')
const AllocationMetricsController = () => import('#controllers/allocation_metrics_controller')
const SystemController = () => import('#controllers/system_controller')
const UtilsController = () => import('#controllers/utils_controller')
const NotificationsController = () => import('#controllers/notifications_controller') // NOVO
const SshAttemptsController = () => import('#controllers/ssh_attempts_controller') // NOVO (Substitui o antigo SshSessionsController)

/**
 * Public Utils Routes (no auth required)
 */
router
  .group(() => {
    router.get('alive', [UtilsController, 'alive']).as('utils.alive')
    router.get('time', [UtilsController, 'time']).as('utils.time')
  })
  .prefix('api')

/**
 * API v1
 */

router
  .group(() => {
    // Rotas Frontend
    router.group(() => {
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

          // --- User Profile Self-Management ---
          router.put('users/me', [UsersController, 'updateMe']).as('users.update.me')
          router.put('users/me/ssh-key', [UsersController, 'updateSshKey']).as('users.updateSshKey') // NOVO

          // --- Notifications (User) ---
          router.get('notifications', [NotificationsController, 'index']).as('notifications.index')
          router
            .patch('notifications/:id/read', [NotificationsController, 'markAsRead'])
            .as('notifications.read')
            .where('id', router.matchers.number())

          // --- Users (Admin Only) ---
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
            .where('id', router.matchers.number())
            .use(middleware.isAdmin()) // Admin Only

          // --- Machine Groups (Admin Only) ---
          router
            .group(() => {
              router.get('/', [MachineGroupsController, 'index']).as('machineGroups.index')
              router.post('/', [MachineGroupsController, 'store']).as('machineGroups.store')
              router.get('/:id', [MachineGroupsController, 'show']).as('machineGroups.show')
              router.put('/:id', [MachineGroupsController, 'update']).as('machineGroups.update')
              router
                .delete('/:id', [MachineGroupsController, 'destroy'])
                .as('machineGroups.destroy')
            })
            .prefix('machine-groups')
            .use(middleware.isAdmin()) // Admin Only
            .where('id', router.matchers.number())

          // --- Machines (GET list + show: General | Mutations: Admin Only) ---
          router.get('/machines', [MachinesController, 'index']).as('machines.index')
          router
            .get('/machines/:id', [MachinesController, 'show'])
            .as('machines.show')
            .where('id', router.matchers.number())

          router
            .group(() => {
              router.post('/', [MachinesController, 'store']).as('machines.store')
              router.put('/:id', [MachinesController, 'update']).as('machines.update')
              router.delete('/:id', [MachinesController, 'destroy']).as('machines.destroy')
              router
                .get('/:id/telemetry', [MachinesController, 'telemetry'])
                .as('machines.telemetry')
              router
                .get('/:id/telemetry/stream', [MachinesController, 'telemetryStream'])
                .as('machines.telemetryStream')
              router
                .post('/:id/regenerate-token', [MachinesController, 'regenerateToken'])
                .as('machines.regenerateToken')
              router
                .post('/:id/request-processes', [MachinesController, 'requestProcessReport'])
                .as('machines.requestProcesses')
            })
            .prefix('machines')
            .where('id', router.matchers.number())
            .use(middleware.isAdmin()) // Admin Only

          // --- SSH Attempts Auditing (Admin only - Substitui ssh-sessions) ---
          router
            .group(() => {
              router.get('/', [SshAttemptsController, 'index']).as('sshAttempts.index')
              router.delete('/:id', [SshAttemptsController, 'destroy']).as('sshAttempts.destroy')
            })
            .prefix('ssh-attempts')
            .use(middleware.isAdmin())
            .where('id', router.matchers.number())

          // --- Machines Allocations (General - anonimizado para users) ---
          router
            .get('/machines/:id/allocations', [AllocationsController, 'machineHistory'])
            .as('machines.allocations')
            .where('id', router.matchers.number())

          // --- Allocations (Mixed Permissions) ---
          router
            .group(() => {
              router.get('/my', [AllocationsController, 'myAllocations']).as('allocations.my') // Busca rápida das próprias reservas
              router.post('/', [AllocationsController, 'store']).as('allocations.store') // General
              router.get('/', [AllocationsController, 'index']).as('allocations.index') // General
              router.patch('/:id', [AllocationsController, 'update']).as('allocations.update') // General
              router.post('/:id/extend', [AllocationsController, 'extend']).as('allocations.extend')
              router
                .delete('/:id', [AllocationsController, 'softDelete'])
                .as('allocations.softDelete') // General (user soft-delete)
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

          // --- System Maintenance (Admin Only) ---
          router
            .group(() => {
              router
                .delete('telemetries/:id', [TelemetriesController, 'destroy'])
                .as('telemetries.destroy')
              router
                .delete('metrics/:id', [AllocationMetricsController, 'destroy'])
                .as('metrics.destroy')
              router
                .delete('prune/telemetries', [SystemController, 'pruneTelemetries'])
                .as('system.prune.telemetries')
              router
                .delete('prune/allocations', [SystemController, 'pruneAllocations'])
                .as('system.prune.allocations')
              router
                .delete('prune/metrics', [SystemController, 'pruneMetrics'])
                .as('system.prune.metrics')
            })
            .prefix('system')
            .use(middleware.isAdmin()) // Admin Only
            .where('id', router.matchers.number())
        })
        .use(middleware.auth())
    })

    /**
     * API v1 - Machine Agent Routes
     * Todas as rotas requerem autenticação via token da máquina.
     */
    router
      .group(() => {
        // --- Heartbeat (inclui should-block e info da alocação atual) ---
        router.post('heartbeat', [AgentController, 'heartbeat']).as('agent.heartbeat')

        // --- Sync & Telemetria ---
        router.put('sync-specs', [AgentController, 'syncSpecs']).as('agent.syncSpecs')
        router.post('telemetry', [AgentController, 'telemetry']).as('agent.telemetry')
      })
      .prefix('agent')
      .use(middleware.machineAuth())
  })
  .prefix('api/v1')
