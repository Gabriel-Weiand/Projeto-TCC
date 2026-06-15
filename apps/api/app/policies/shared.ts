import { AuthorizationResponse } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import type User from '#models/user'

export function isAdmin(user: User): boolean {
  return user.role === 'admin'
}

export function isOwnerOrAdmin(user: User, ownerId: number): boolean {
  return isAdmin(user) || user.id === ownerId
}

/**
 * Nega autorização com código estável para o handler HTTP ({ code, message }).
 */
export function denyWithCode(
  code: string,
  message: string,
  status = 403
): AuthorizerResponse {
  return AuthorizationResponse.deny(message, status).t(code, { code })
}

export function allowOwnerOrAdmin(
  user: User,
  ownerId: number,
  message: string,
  code = 'NOT_OWNER'
): AuthorizerResponse {
  if (isOwnerOrAdmin(user, ownerId)) {
    return true
  }
  return denyWithCode(code, message)
}
