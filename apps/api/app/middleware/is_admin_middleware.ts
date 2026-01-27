import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Is admin middleware is used to ensure that only admin users
 * can access certain resources.
 */
export default class IsAdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user

    if (!user || user.role !== 'admin') {
      return ctx.response.forbidden({
        message: 'Only admins can access this resource',
      })
    }

    return next()
  }
}
