import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { registerValidator } from '#validators/auth_user'
import { updateUserValidator } from '#validators/user'

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
   * Atualiza um usuário.
   * - User normal: só pode atualizar seu próprio perfil (não pode alterar role)
   * - Admin: pode atualizar qualquer usuário
   * 
   * PUT /api/v1/users/:id
   */
  async update({ auth, params, request, response }: HttpContext) {
    const currentUser = auth.user!
    const targetUser = await User.findOrFail(params.id)
    
    // User normal só pode atualizar seu próprio perfil
    if (currentUser.role !== 'admin' && currentUser.id !== targetUser.id) {
      return response.forbidden({
        code: 'NOT_OWNER',
        message: 'Você só pode atualizar seu próprio perfil.',
      })
    }

    // Passa userId no meta para validação de unicidade do email
    const data = await request.validateUsing(updateUserValidator, {
      meta: { userId: targetUser.id },
    })

    // User normal não pode alterar role
    if (currentUser.role !== 'admin' && data.role) {
      return response.forbidden({
        code: 'CANNOT_CHANGE_ROLE',
        message: 'Você não tem permissão para alterar roles.',
      })
    }

    targetUser.merge(data)
    await targetUser.save()

    return response.ok(targetUser)
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
