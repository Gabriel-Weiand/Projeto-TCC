import app from '@adonisjs/core/services/app'
import { HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { DomainError, isDomainError } from '#services/shared/domain_error'

function domainErrorBody(error: DomainError): Record<string, unknown> {
  return {
    code: error.code,
    message: error.message,
    ...error.details,
  }
}

function domainErrorStatus(error: DomainError): number {
  return error.status
}

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    if (isDomainError(error)) {
      return ctx.response.status(domainErrorStatus(error)).send(domainErrorBody(error))
    }

    if (error instanceof bouncerErrors.E_AUTHORIZATION_FAILURE) {
      const status = error.response.status || error.status || 403
      const message = error.getResponseMessage(ctx)
      const code =
        (error.response.translation?.identifier as string | undefined) ??
        (error.response.translation?.data?.code as string | undefined) ??
        'FORBIDDEN'

      return ctx.response.status(status).send({ code, message })
    }

    return super.handle(error, ctx)
  }

  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
