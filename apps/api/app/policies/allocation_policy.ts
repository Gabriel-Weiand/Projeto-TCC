import User from '#models/user'
import Allocation from '#models/allocation'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { allowOwnerOrAdmin, isAdmin } from '#policies/shared'

export default class AllocationPolicy extends BasePolicy {
  /**
   * Dono ou admin pode estender a reserva.
   */
  extend(user: User, allocation: Allocation): AuthorizerResponse {
    return allowOwnerOrAdmin(
      user,
      allocation.userId,
      'Apenas o dono pode estender a alocação.'
    )
  }

  /**
   * Dono ou admin pode finalizar a sessão.
   */
  finish(user: User, allocation: Allocation): AuthorizerResponse {
    return allowOwnerOrAdmin(
      user,
      allocation.userId,
      'Apenas o dono pode finalizar a alocação.'
    )
  }

  /**
   * Dono ou admin pode alterar/cancelar (regras de negócio ficam no service).
   */
  update(user: User, allocation: Allocation): AuthorizerResponse {
    return allowOwnerOrAdmin(
      user,
      allocation.userId,
      'Você só pode alterar suas próprias alocações.'
    )
  }

  /**
   * Dono ou admin pode ocultar do histórico.
   */
  delete(user: User, allocation: Allocation): AuthorizerResponse {
    return allowOwnerOrAdmin(
      user,
      allocation.userId,
      'Você só pode remover suas próprias alocações.'
    )
  }

  /**
   * Dono ou admin pode ver o resumo de sessão.
   */
  viewSummary(user: User, allocation: Allocation): AuthorizerResponse {
    return allowOwnerOrAdmin(
      user,
      allocation.userId,
      'Você só pode visualizar o resumo das suas próprias alocações.'
    )
  }

  /**
   * Apenas admin gera resumo manualmente (POST /summary).
   */
  summarize(_user: User): AuthorizerResponse {
    return isAdmin(_user)
  }
}
