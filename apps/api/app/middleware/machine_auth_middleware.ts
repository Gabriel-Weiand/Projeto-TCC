import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { machineCache } from '#services/machine_cache'

export default class MachineAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const authHeader = ctx.request.header('authorization')

    if (!authHeader) {
      return ctx.response.unauthorized({
        code: 'MISSING_HEADER',
        message: 'Authorization header is missing',
      })
    }

    const token = authHeader.replace('Bearer ', '').trim()

    if (!token) {
      return ctx.response.unauthorized({
        code: 'MISSING_TOKEN',
        message: 'Machine token is missing',
      })
    }

    // Verifica MAC Address obrigatório
    const macAddress = ctx.request.header('x-machine-mac')?.trim()

    if (!macAddress) {
      return ctx.response.unauthorized({
        code: 'MISSING_MAC',
        message: 'X-Machine-Mac header is required',
      })
    }

    // Busca no cache primeiro, só vai ao banco se necessário
    const machine = await machineCache.getByToken(token)

    if (!machine) {
      return ctx.response.unauthorized({
        code: 'INVALID_TOKEN',
        message: 'Invalid machine credentials',
      })
    }

    // Verifica se o MAC Address corresponde ao registrado
    if (machine.macAddress.toLowerCase() !== macAddress.toLowerCase()) {
      return ctx.response.unauthorized({
        code: 'MAC_MISMATCH',
        message: 'MAC address does not match the registered machine',
      })
    }

    // Anexa a máquina ao contexto para o Controller usar
    ctx.authenticatedMachine = machine

    return next()
  }
}
