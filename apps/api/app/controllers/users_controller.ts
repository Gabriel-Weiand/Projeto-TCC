import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { registerValidator } from '#validators/auth_user'

export default class UsersController {
  //Listar todos os usuários (Apenas Admin)
  async index({ response }: HttpContext) {
    const users = await User.all()
    return response.ok(users)
  }

  //Cria novo usuário
  async store({ request, response }: HttpContext) {
    // 1. Validação dos dados de entrada
    // Se o validator falhar, o Adonis retorna erro 422 automaticamente aqui.
    const payload = await request.validateUsing(registerValidator)

    // 2. Criação do Usuário
    // O hook @beforeSave no Model User vai criar o hash da senha automaticamente
    const user = await User.create(payload)

    // 3. Retorno 201 Created
    return response.created(user)
  }

  //Exibe um usuário específico
  async show({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    return response.ok(user)
  }

  //Atualiza dados (Ex: Nome ou Senha)
  async update({ params, request, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const data = request.only(['fullName', 'password']) // Defina o que pode ser atualizado

    user.merge(data)
    await user.save()

    return response.ok(user)
  }

  //Remover usuário (Apenas Admin)
  async destroy({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await user.delete()
    return response.noContent()
  }
}
