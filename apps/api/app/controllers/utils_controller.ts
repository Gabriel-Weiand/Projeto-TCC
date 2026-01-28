import type { HttpContext } from '@adonisjs/core/http'

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
}
