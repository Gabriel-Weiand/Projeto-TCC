import User from '#models/user'

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

  async logout(user: User): Promise<{ message: string }> {
    await User.accessTokens.delete(user, user.currentAccessToken.identifier)
    return { message: 'Logged out successfully' }
  },
}
