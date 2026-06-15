/**
 * Scheduler - Tarefas agendadas que rodam junto com o servidor
 *
 * Este arquivo é importado no boot do servidor e agenda tarefas
 * usando node-cron.
 */

import cron from 'node-cron'
import logger from '@adonisjs/core/services/logger'
import { autoFinalizeExpired } from '#services/allocation/summarizer'
import { labConfig } from '#services/lab/config'
import { runLabMaintenance } from '#services/lab/maintenance'
import {
  runScheduledAllocationReminders,
  notifyOfflineAgents,
} from '#services/notification/notification_service'

/**
 * Manutenção sistemática: tokens, resumo TWA, prune de alocações/notificações/SSH.
 * Roda conforme LAB_SCHEDULER_MAINTENANCE_CRON (padrão: a cada 4 h).
 */
function scheduleMaintenance() {
  cron.schedule(labConfig.schedulers.maintenanceCron, async () => {
    try {
      const result = await runLabMaintenance()
      const total =
        result.tokens +
        result.summarized +
        result.allocations +
        result.notifications +
        result.sshAttempts

      if (total > 0) {
        logger.info(
          `[Scheduler] Maintenance: tokens=${result.tokens} summarized=${result.summarized} allocations=${result.allocations} notifications=${result.notifications} ssh=${result.sshAttempts}`
        )
      }
    } catch (error) {
      logger.error('[Scheduler] Failed maintenance run:', error)
    }
  })

  logger.info(`[Scheduler] Maintenance scheduled (${labConfig.schedulers.maintenanceCron})`)
}

/**
 * Finalização automática, lembretes e alertas de agente offline.
 * Roda conforme LAB_SCHEDULER_AUTO_FINALIZE_CRON (padrão: a cada 5 min).
 */
function scheduleOperationalJobs() {
  cron.schedule(labConfig.schedulers.autoFinalizeCron, async () => {
    try {
      const count = await autoFinalizeExpired()
      if (count > 0) {
        logger.info(`[Scheduler] Auto-finalized ${count} expired allocation(s)`)
      }

      const reminders = await runScheduledAllocationReminders()
      const offline = await notifyOfflineAgents()
      const notifTotal = reminders.upcoming + reminders.sshT5 + reminders.sshT0 + offline
      if (notifTotal > 0) {
        logger.info(
          `[Scheduler] Notifications: upcoming=${reminders.upcoming} sshT5=${reminders.sshT5} sshT0=${reminders.sshT0} offline=${offline}`
        )
      }
    } catch (error) {
      logger.error('[Scheduler] Failed operational jobs:', error)
    }
  })

  logger.info(`[Scheduler] Operational jobs (${labConfig.schedulers.autoFinalizeCron})`)
}

/**
 * Inicializa todos os schedulers.
 * Chamado no boot do servidor.
 */
export function initScheduler() {
  scheduleMaintenance()
  scheduleOperationalJobs()
}
