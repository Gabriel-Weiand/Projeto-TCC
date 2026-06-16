import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Lazy Loading Controllers
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const AgentController = () => import('#controllers/agent_controller')
const MachinesController = () => import('#controllers/machines_controller')
const MachineGroupsController = () => import('#controllers/machine_groups_controller')
const AllocationsController = () => import('#controllers/allocations_controller')
const SystemController = () => import('#controllers/system_controller')
const UtilsController = () => import('#controllers/utils_controller')
const NotificationsController = () => import('#controllers/notifications_controller')
const SshAttemptsController = () => import('#controllers/ssh_attempts_controller')
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
    router.group(() => {
      // ====================================================================
      // PUBLIC
      // ====================================================================
      router.post('login', [AuthController, 'login']).as('auth.login')

      // ====================================================================
      // AUTHENTICATED — qualquer usuário logado
      // Autorização por recurso (dono vs admin) via Bouncer nos controllers.
      // ====================================================================
      router
        .group(() => {
          // --- Sessão & perfil próprio ---
          router.delete('logout', [AuthController, 'logout']).as('auth.logout')
          router.get('me', [AuthController, 'me']).as('auth.me')
          router.put('users/me', [UsersController, 'updateMe']).as('users.update.me')
          router.put('users/me/ssh-key', [UsersController, 'updateSshKey']).as('users.updateSshKey')

          // --- Notificações (inbox do usuário; policy: somente dono) ---
          router.get('notifications', [NotificationsController, 'index']).as('notifications.index')
          router
            .patch('notifications/:id/read', [NotificationsController, 'markAsRead'])
            .as('notifications.read')
            .where('id', router.matchers.number())
          router
            .delete('notifications/:id', [NotificationsController, 'destroy'])
            .as('notifications.destroy')
            .where('id', router.matchers.number())

          // --- Máquinas (leitura para todos; mutações no bloco admin) ---
          router.get('/machines', [MachinesController, 'index']).as('machines.index')
          router
            .get('/machines/:id', [MachinesController, 'show'])
            .as('machines.show')
            .where('id', router.matchers.number())
          router
            .get('/machines/:id/allocations', [AllocationsController, 'machineHistory'])
            .as('machines.allocations')
            .where('id', router.matchers.number())
          router
            .get('/machines/:id/telemetry', [MachinesController, 'telemetry'])
            .as('machines.telemetry')
            .where('id', router.matchers.number())
          router
            .get('/machines/:id/telemetry/stream', [MachinesController, 'telemetryStream'])
            .as('machines.telemetryStream')
            .where('id', router.matchers.number())

          // --- Alocações (rotas mistas; policy: dono OU admin) ---
          router
            .group(() => {
              router.get('/my', [AllocationsController, 'myAllocations']).as('allocations.my')
              router.post('/', [AllocationsController, 'store']).as('allocations.store')
              router.get('/', [AllocationsController, 'index']).as('allocations.index')
              router.patch('/:id', [AllocationsController, 'update']).as('allocations.update')
              router.post('/:id/extend', [AllocationsController, 'extend']).as('allocations.extend')
              router.post('/:id/finish', [AllocationsController, 'finish']).as('allocations.finish')
              router
                .delete('/:id', [AllocationsController, 'softDelete'])
                .as('allocations.softDelete')
              router
                .get('/:id/summary', [AllocationsController, 'getSessionSummary'])
                .as('allocations.summary.show')
            })
            .prefix('allocations')
            .where('id', router.matchers.number())

          // ====================================================================
          // ADMIN ONLY — middleware.isAdmin() (barreira de rota)
          // Sem checagem de dono: ações globais do laboratório.
          // ====================================================================
          router
            .group(() => {
              router.post('/', [UsersController, 'store']).as('users.store')
              router.get('/', [UsersController, 'index']).as('users.index')
              router.put('/:id', [UsersController, 'update']).as('users.update')
              router.delete('/:id', [UsersController, 'destroy']).as('users.destroy')
            })
            .prefix('users')
            .where('id', router.matchers.number())
            .use(middleware.isAdmin())

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
            .where('id', router.matchers.number())
            .use(middleware.isAdmin())

          router
            .group(() => {
              router.post('/', [MachinesController, 'store']).as('machines.store')
              router.put('/:id', [MachinesController, 'update']).as('machines.update')
              router.delete('/:id', [MachinesController, 'destroy']).as('machines.destroy')
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
            .use(middleware.isAdmin())

          router
            .group(() => {
              router.get('/', [SshAttemptsController, 'index']).as('sshAttempts.index')
            })
            .prefix('ssh-attempts')
            .use(middleware.isAdmin())

          // Admin gera resumo; middleware + AllocationPolicy.summarize no controller
          router
            .post('allocations/:id/summary', [AllocationsController, 'summarizeSession'])
            .as('allocations.summary.create')
            .where('id', router.matchers.number())
            .use(middleware.isAdmin())

          router
            .group(() => {
              router
                .post('maintenance/run', [SystemController, 'runMaintenance'])
                .as('system.maintenance.run')
              router
                .delete('allocations/:id', [SystemController, 'destroyAllocation'])
                .as('system.allocations.destroy')
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
            .where('id', router.matchers.number())
            .use(middleware.isAdmin())
        })
        .use(middleware.auth())
    })

    /**
     * API v1 — Agent (token da máquina, não usuário)
     */
    router
      .group(() => {
        router.post('heartbeat', [AgentController, 'heartbeat']).as('agent.heartbeat')
        router.put('sync-specs', [AgentController, 'syncSpecs']).as('agent.syncSpecs')
        router.post('telemetry', [AgentController, 'telemetry']).as('agent.telemetry')
      })
      .prefix('agent')
      .use(middleware.machineAuth())
  })
  .prefix('api/v1')
