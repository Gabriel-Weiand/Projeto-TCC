import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'

export type LoginResult = {
  type: 'bearer'
  value: string
  expiresAt: Date | null
  user: User
}

export const AuthService = {
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await User.verifyCredentials(email, password)

    const existingTokens = await User.accessTokens.all(user)
    for (const token of existingTokens) {
      await User.accessTokens.delete(user, token.identifier)
    }

    const token = await User.accessTokens.create(user)

    return {
      type: 'bearer',
      value: token.value!.release(),
      expiresAt: token.expiresAt,
      user,
    }
  },

  async logout(auth: HttpContext['auth']): Promise<{ message: string }> {
    await auth.use('api').invalidateToken()
    return { message: 'Logged out successfully' }
  },
}
