import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Lazy Loading Controllers
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const AgentController = () => import('#controllers/agent_controller')
const MachinesController = () => import('#controllers/machines_controller')
const MachineGroupsController = () => import('#controllers/machine_groups_controller') // NOVO
const AllocationsController = () => import('#controllers/allocations_controller')
const SystemController = () => import('#controllers/system_controller')
const UtilsController = () => import('#controllers/utils_controller')
const NotificationsController = () => import('#controllers/notifications_controller') // NOVO
const SshAttemptsController = () => import('#controllers/ssh_attempts_controller') // NOVO (Substitui o antigo SshSessionsController)
const LabTelemetryController = () => import('#controllers/lab_telemetry_controller')
const LabSettingsController = () => import('#controllers/lab_settings_controller')

/**
 * Public Utils Routes (no auth required)
 */
router
  .group(() => {
    router.get('alive', [UtilsController, 'alive']).as('utils.alive')
    router.get('time', [UtilsController, 'time']).as('utils.time')
    router.get('config', [UtilsController, 'config']).as('utils.config')
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
          router
            .delete('notifications/:id', [NotificationsController, 'destroy'])
            .as('notifications.destroy')
            .where('id', router.matchers.number())

          // --- Users (Admin Only) ---
          router
            .group(() => {
              router.post('/', [UsersController, 'store']).as('users.store')
              router.get('/', [UsersController, 'index']).as('users.index')
              router.put('/:id', [UsersController, 'update']).as('users.update')
              router.delete('/:id', [UsersController, 'destroy']).as('users.destroy')
            })
            .prefix('users')
            .where('id', router.matchers.number())
            .use(middleware.isAdmin()) // Admin Only

          // --- Lab config (Admin Only) ---
          router
            .group(() => {
              router
                .get('telemetry-presets', [LabTelemetryController, 'show'])
                .as('lab.telemetryPresets.show')
              router
                .put('telemetry-presets', [LabTelemetryController, 'update'])
                .as('lab.telemetryPresets.update')
              router.get('settings', [LabSettingsController, 'show']).as('lab.settings.show')
              router.put('settings', [LabSettingsController, 'update']).as('lab.settings.update')
            })
            .prefix('lab')
            .use(middleware.isAdmin())

          // --- Machine Groups (Admin Only) ---
          router
            .group(() => {
              router.get('/', [MachineGroupsController, 'index']).as('machineGroups.index')
              router.post('/', [MachineGroupsController, 'store']).as('machineGroups.store')
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
                .get('/:id/provisioned-users', [MachinesController, 'provisionedUsers'])
                .as('machines.provisionedUsers.index')
              router
                .post('/:id/provisioned-users', [MachinesController, 'storeProvisionedUser'])
                .as('machines.provisionedUsers.store')
              router
                .patch('/:id/provisioned-users/:userId', [
                  MachinesController,
                  'updateProvisionedUser',
                ])
                .as('machines.provisionedUsers.update')
                .where('userId', router.matchers.number())
              router
                .delete('/:id/provisioned-users/:userId', [
                  MachinesController,
                  'destroyProvisionedUser',
                ])
                .as('machines.provisionedUsers.destroy')
                .where('userId', router.matchers.number())
            })
            .prefix('machines')
            .where('id', router.matchers.number())
            .use(middleware.isAdmin()) // Admin Only

          // --- SSH Attempts Auditing (Admin only) ---
          router
            .group(() => {
              router.get('/', [SshAttemptsController, 'index']).as('sshAttempts.index')
            })
            .prefix('ssh-attempts')
            .use(middleware.isAdmin())

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
              router.post('/:id/finish', [AllocationsController, 'finish']).as('allocations.finish')
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
                .post('maintenance/run', [SystemController, 'runMaintenance'])
                .as('system.maintenance.run')
              router
                .delete('allocations/:id', [SystemController, 'destroyAllocation'])
                .as('system.allocations.destroy')
              router
                .delete('notifications/:id', [SystemController, 'destroyNotification'])
                .as('system.notifications.destroy')
              router
                .delete('ssh-attempts/:id', [SystemController, 'destroySshAttempt'])
                .as('system.sshAttempts.destroy')
              router
                .delete('prune/notifications', [SystemController, 'pruneNotifications'])
                .as('system.prune.notifications')
              router
                .delete('prune/ssh-attempts', [SystemController, 'pruneSshAttempts'])
                .as('system.prune.sshAttempts')
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
