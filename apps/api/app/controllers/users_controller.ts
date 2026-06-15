import type { HttpContext } from '@adonisjs/core/http'
import { registerValidator } from '#validators/auth_user'
import { updateUserValidator, updateSshKeyValidator } from '#validators/user'
import { UserService } from '#services/user/user_service'

export default class UsersController {
  /**
   * Lista todos os usuários.
   *
   * GET /api/v1/users
   */
  async index({ response }: HttpContext) {
    const users = await UserService.listUsers()
    return response.ok(users)
  }

  /**
   * Cria um novo usuário.
   *
   * POST /api/v1/users
   */
  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(registerValidator)
    const user = await UserService.createUser(payload)
    return response.created(user)
  }

  /**
   * Atualiza um usuário (Exclusivo para ADMIN).
   *
   * PUT /api/v1/users/:id
   */
  async update({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(updateUserValidator, {
      meta: { userId: Number(params.id) },
    })
    const user = await UserService.updateUserByAdmin(Number(params.id), data)
    return response.ok(user)
  }

  async updateMe({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(updateUserValidator, {
      meta: { userId: user.id },
    })
    const updated = await UserService.updateOwnProfile(user, data)
    return response.ok(updated)
  }

  async updateSshKey({ auth, request, response }: HttpContext) {
    const { sshPublicKey } = await request.validateUsing(updateSshKeyValidator)
    const user = await UserService.updateSshKey(auth.user!, sshPublicKey)
    return response.ok(user)
  }

  /**
   * Remove um usuário.
   *
   * DELETE /api/v1/users/:id
   */
  async destroy({ params, response }: HttpContext) {
    await UserService.deleteUser(Number(params.id))
    return response.noContent()
  }
}
