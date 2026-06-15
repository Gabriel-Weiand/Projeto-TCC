import type { HttpContext } from '@adonisjs/core/http'
import {
  createAllocationValidator,
  updateAllocationValidator,
  listAllocationsValidator,
  extendAllocationValidator,
} from '#validators/allocation'
import { AllocationService } from '#services/allocation/allocation_service'
import { runWithDomainError } from '#controllers/shared/handle_domain_error'

export default class AllocationsController {
  /**
   * Lista apenas as alocações do utilizador autenticado.
   * GET /api/v1/allocations/my
   */
  async myAllocations({ auth, request, response }: HttpContext) {
    const filters = await request.validateUsing(listAllocationsValidator)
    const result = await AllocationService.listMyAllocations(auth.user!, filters)
    return response.ok(result)
  }

  /**
   * Lista alocações com filtros opcionais.
   * GET /api/v1/allocations
   */
  async index({ auth, request, response }: HttpContext) {
    const filters = await request.validateUsing(listAllocationsValidator)
    const result = await AllocationService.listAllocations(auth.user!, filters)
    return response.ok(result)
  }

  /**
   * Cria uma nova alocação.
   * POST /api/v1/allocations
   */
  async store({ auth, request, response }: HttpContext) {
    const data = await request.validateUsing(createAllocationValidator)

    return runWithDomainError(
      response,
      () => AllocationService.createAllocation(auth.user!, data),
      (allocation) => response.created(allocation)
    )
  }

  /**
   * Estende o fim da reserva.
   * POST /api/v1/allocations/:id/extend
   */
  async extend({ auth, params, request, response }: HttpContext) {
    const payload = await request.validateUsing(extendAllocationValidator)

    return runWithDomainError(
      response,
      () => AllocationService.extendAllocation(auth.user!, Number(params.id), payload),
      (allocation) => response.ok(allocation)
    )
  }

  /**
   * Finaliza antecipadamente uma sessão aprovada.
   * POST /api/v1/allocations/:id/finish
   */
  async finish({ auth, params, response }: HttpContext) {
    return runWithDomainError(
      response,
      () => AllocationService.finishAllocation(auth.user!, Number(params.id)),
      (allocation) => response.ok(allocation)
    )
  }

  /**
   * Atualiza uma alocação (status, horário, etc).
   * PATCH /api/v1/allocations/:id
   */
  async update({ auth, params, request, response }: HttpContext) {
    const data = await request.validateUsing(updateAllocationValidator)

    return runWithDomainError(
      response,
      () => AllocationService.updateAllocation(auth.user!, Number(params.id), data),
      (allocation) => response.ok(allocation)
    )
  }

  /**
   * Soft-delete de uma alocação pelo usuário.
   * DELETE /api/v1/allocations/:id
   */
  async softDelete({ auth, params, response }: HttpContext) {
    return runWithDomainError(
      response,
      () => AllocationService.softDeleteAllocation(auth.user!, Number(params.id)),
      (result) => response.ok(result)
    )
  }

  /**
   * Histórico de alocações de uma máquina.
   * GET /api/v1/machines/:id/allocations
   */
  async machineHistory({ auth, params, request, response }: HttpContext) {
    const { page = 1, limit = 20 } = request.qs()
    const result = await AllocationService.machineHistory(
      auth.user!,
      Number(params.id),
      Number(page),
      Number(limit)
    )
    return response.ok(result)
  }

  /**
   * Gera resumo/métricas de uma sessão (alocação).
   * POST /api/v1/allocations/:id/summary
   */
  async summarizeSession({ params, response }: HttpContext) {
    return runWithDomainError(
      response,
      () => AllocationService.summarizeSession(Number(params.id)),
      (metric) => response.created(metric)
    )
  }

  /**
   * Retorna o resumo/métricas de uma sessão.
   * GET /api/v1/allocations/:id/summary
   */
  async getSessionSummary({ auth, params, response }: HttpContext) {
    return runWithDomainError(
      response,
      () => AllocationService.getSessionSummary(auth.user!, Number(params.id)),
      (metric) => response.ok(metric)
    )
  }
}
