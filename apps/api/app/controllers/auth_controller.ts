import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator } from '#validators/auth_user'

export default class AuthController {
  //Login
  async login({ request, response }: HttpContext) {
    // 1. Valida email (formato) e senha (tamanho)
    const { email, password } = await request.validateUsing(loginValidator)

    // 2. Verifica as credenciais
    // O verifyCredentials busca o user pelo email e compara o hash da senha
    // Se falhar, ele lança uma exceção automática 'Invalid credentials'
    const user = await User.verifyCredentials(email, password)

    // 3. Cria o token de acesso (Opaque Token)
    const token = await User.accessTokens.create(user)

    // 4. Retorna o token para o frontend
    return response.ok({
      type: 'bearer',
      value: token.value!.release(),
      user: user, // Opcional: retornar dados básicos do user junto
    })
  }

  //Logout
  async logout({ auth, response }: HttpContext) {
    // Pega o usuário autenticado via middleware
    const user = auth.user!

    // Apaga APENAS o token desta requisição
    await User.accessTokens.delete(user, user.currentAccessToken.identifier)

    return response.ok({ message: 'Logged out successfully' })
  }

  //Recupera dados do usuário logado
  async me({ auth, response }: HttpContext) {
    return response.ok(auth.user)
  }
}
