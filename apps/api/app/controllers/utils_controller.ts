import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { labConfig, labNow, labPublicConfig } from '#services/lab/config'

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
    const nowUtc = DateTime.utc()
    const nowLab = labNow()
    return response.ok({
      utc: nowUtc.toISO(),
      unixMs: nowUtc.toMillis(),
      timezone: labConfig.timezone,
      localIso: nowLab.toISO(),
      localDate: nowLab.toISODate(),
    })
  }

  /**
   * Configuração pública do laboratório (calendário, limites de reserva, auth, fuso).
   *
   * GET /api/config
   */
  async config({ response }: HttpContext) {
    return response.ok(labPublicConfig())
  }
}
