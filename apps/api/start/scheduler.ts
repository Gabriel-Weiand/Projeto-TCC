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

/**
 * Remove tokens de acesso expirados do banco de dados.
 * Roda todo dia às 3h da manhã.
 */
function schedulePruneTokens() {
  // Cron: minuto hora dia mês dia-da-semana
  // '0 3 * * *' = todo dia às 3:00
  cron.schedule('0 3 * * *', async () => {
    try {
      const now = DateTime.now().toSQL()

      const result = await db
        .from('auth_access_tokens')
        .where('expires_at', '<', now)
        .delete()

      if (result[0] > 0) {
        logger.info(`[Scheduler] Pruned ${result[0]} expired token(s)`)
      }
    } catch (error) {
      logger.error('[Scheduler] Failed to prune tokens:', error)
    }
  })

  logger.info('[Scheduler] Token pruning scheduled for 3:00 AM daily')
}

/**
 * Inicializa todos os schedulers.
 * Chamado no boot do servidor.
 */
export function initScheduler() {
  schedulePruneTokens()
  
  // Adicione outras tarefas agendadas aqui no futuro
  // scheduleOtherTask()
}
