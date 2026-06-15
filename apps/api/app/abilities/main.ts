import User from '#models/user'
import { Bouncer } from '@adonisjs/bouncer'

/**
 * Apenas administradores do laboratório.
 */
export const isAdmin = Bouncer.ability((user: User) => {
  return user.role === 'admin'
})
