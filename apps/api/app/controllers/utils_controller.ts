import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class UtilsController {
  /**
   * Health check - Verifica se a API está funcionando.
   * 
   * GET /api/alive
   */
  async alive({ response }: HttpContext) {
    return response.ok({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  }

  /**
   * Retorna horário UTC do servidor.
   * Endpoint público usado por agentes e frontend para sincronização de relógio.
   *
   * GET /api/time
   */
  async time({ response }: HttpContext) {
    const now = DateTime.now()
    return response.ok({
      utc: now.toISO(),
      unixMs: now.toMillis(),
    })
  }
}
