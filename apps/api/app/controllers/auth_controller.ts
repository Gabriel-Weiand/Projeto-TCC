import type { HttpContext } from '@adonisjs/core/http'
import { loginValidator } from '#validators/auth_user'
import { AuthService } from '#services/auth/auth_service'

export default class AuthController {
  async login({ request, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const result = await AuthService.login(email, password)
    return response.ok(result)
  }

  async logout({ auth, response }: HttpContext) {
    const result = await AuthService.logout(auth)
    return response.ok(result)
  }

  async me({ auth, response }: HttpContext) {
    return response.ok(auth.user)
  }
}
