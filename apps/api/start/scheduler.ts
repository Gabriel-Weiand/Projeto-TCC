/**
 * Scheduler - Tarefas agendadas que rodam junto com o servidor
 *
 * Este arquivo é importado no boot do servidor e agenda tarefas
 * usando node-cron.
 */

import cron from 'node-cron'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { autoFinalizeExpired } from '#services/allocation_summarizer'
import { labConfig } from '#services/lab_config'
import {
  runScheduledAllocationReminders,
  notifyOfflineAgents,
} from '#services/notification_service'

/**
 * Remove tokens de acesso expirados do banco de dados.
 * Roda todo dia às 3h da manhã.
 */
function schedulePruneTokens() {
  // Cron: minuto hora dia mês dia-da-semana
  // '0 3 * * *' = todo dia às 3:00
  cron.schedule(labConfig.schedulers.pruneTokensCron, async () => {
    try {
      const now = DateTime.now().toSQL()

      const result = await db.from('auth_access_tokens').where('expires_at', '<', now).delete()

      if (result[0] > 0) {
        logger.info(`[Scheduler] Pruned ${result[0]} expired token(s)`)
      }
    } catch (error) {
      logger.error('[Scheduler] Failed to prune tokens:', error)
    }
  })

  logger.info(
    `[Scheduler] Token pruning scheduled (${labConfig.schedulers.pruneTokensCron})`
  )
}

/**
 * Finaliza automaticamente alocações aprovadas cujo horário já expirou.
 * Roda a cada 5 minutos.
 */
function scheduleAutoFinalize() {
  cron.schedule(labConfig.schedulers.autoFinalizeCron, async () => {
    try {
      const count = await autoFinalizeExpired()
      if (count > 0) {
        logger.info(`[Scheduler] Auto-finalized ${count} expired allocation(s)`)
      }
    } catch (error) {
      logger.error('[Scheduler] Failed to auto-finalize:', error)
    }
  })

  logger.info(
    `[Scheduler] Auto-finalize scheduled (${labConfig.schedulers.autoFinalizeCron})`
  )
}

/**
 * Inicializa todos os schedulers.
 * Chamado no boot do servidor.
 */
/**
 * Lembretes T-10, chave SSH T-5/T-0 e alerta de agente offline.
 * Roda no mesmo intervalo do auto-finalize (padrão: a cada 5 min).
 * Agente offline: verifica a cada tick, mas renotifica no máximo 1×/24 h por máquina (LAB_NOTIF_AGENT_OFFLINE_COOLDOWN_HOURS).
 */
function scheduleNotificationJobs() {
  cron.schedule(labConfig.schedulers.autoFinalizeCron, async () => {
    try {
      const reminders = await runScheduledAllocationReminders()
      const offline = await notifyOfflineAgents()
      const total = reminders.upcoming + reminders.sshT5 + reminders.sshT0 + offline
      if (total > 0) {
        logger.info(
          `[Scheduler] Notifications: upcoming=${reminders.upcoming} sshT5=${reminders.sshT5} sshT0=${reminders.sshT0} offline=${offline}`
        )
      }
    } catch (error) {
      logger.error('[Scheduler] Failed notification jobs:', error)
    }
  })

  logger.info(`[Scheduler] Notification jobs (${labConfig.schedulers.autoFinalizeCron})`)
}

export function initScheduler() {
  schedulePruneTokens()
  scheduleAutoFinalize()
  scheduleNotificationJobs()
}
