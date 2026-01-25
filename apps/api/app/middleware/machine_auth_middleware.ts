import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import Machine from '#models/machine'

export default class MachineAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // 1. Pega o header Authorization
    const authHeader = ctx.request.header('authorization')

    // Validação básica: O header existe?
    if (!authHeader) {
      return ctx.response.unauthorized({
        code: 'MISSING_HEADER',
        message: 'Authorization header is missing',
      })
    }

    // Remove o 'Bearer ' para pegar só o token
    const token = authHeader.replace('Bearer ', '').trim()

    if (!token) {
      return ctx.response.unauthorized({
        code: 'MISSING_TOKEN',
        message: 'Machine token is missing',
      })
    }

    // Busca a máquina no banco pelo Token
    const machine = await Machine.findBy('token', token)

    // Se não achou máquina, nega o acesso
    if (!machine) {
      return ctx.response.unauthorized({
        code: 'INVALID_TOKEN',
        message: 'Invalid machine credentials',
      })
    }

    // 6. [OPCIONAL MAS RECOMENDADO]
    // Anexa a máquina encontrada ao contexto para o Controller usar depois.
    // Assim, no Controller você não precisa buscar a máquina de novo.
    ctx.authenticatedMachine = machine

    return next()
  }
}
