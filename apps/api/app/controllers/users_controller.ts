import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { registerValidator } from '#validators/auth_user'
import { updateUserValidator, updateSshKeyValidator } from '#validators/user'
import { notifySshKeyRequired } from '#services/notification_service'

export default class UsersController {
  /**
   * Lista todos os usuários.
   *
   * GET /api/v1/users
   */
  async index({ response }: HttpContext) {
    const users = await User.query().orderBy('fullName', 'asc')
    return response.ok(users)
  }

  /**
   * Cria um novo usuário.
   *
   * POST /api/v1/users
   */
  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(registerValidator)
    const user = await User.create(payload)
    await notifySshKeyRequired(user.id)

    return response.created(user)
  }

  /**
   * Exibe um usuário específico.
   *
   * GET /api/v1/users/:id
   */
  async show({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    return response.ok(user)
  }

  /**
   * Atualiza um usuário (Exclusivo para ADMIN).
   * * PUT /api/v1/users/:id
   */
  async update({ params, request, response }: HttpContext) {
    const targetUser = await User.findOrFail(params.id)

    // Passa userId no meta para validação de unicidade do email
    const data = await request.validateUsing(updateUserValidator, {
      meta: { userId: targetUser.id },
    })

    targetUser.merge(data)
    await targetUser.save()

    return response.ok(targetUser)
  }

  async updateMe({ auth, request, response }: HttpContext) {
    const user = auth.user!

    // Passa o userId no meta para a validação de unicidade do email ignorar o próprio utilizador
    const data = await request.validateUsing(updateUserValidator, {
      meta: { userId: user.id },
    })

    // Garante que o utilizador normal nunca consegue injetar a role 'admin'
    if (data.role && data.role !== user.role) {
      delete data.role
    }

    user.merge(data)
    await user.save()

    return response.ok(user)
  }

  async updateSshKey({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const { sshPublicKey } = await request.validateUsing(updateSshKeyValidator)

    user.sshPublicKey = sshPublicKey
    await user.save()

    return response.ok(user)
  }

  /**
   * Remove um usuário.
   *
   * DELETE /api/v1/users/:id
   */
  async destroy({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await user.delete()

    return response.noContent()
  }
}
