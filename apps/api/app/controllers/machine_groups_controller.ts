import type { HttpContext } from '@adonisjs/core/http'
import {
  machineGroupValidator,
  updateMachineGroupValidator,
} from '#validators/machine_group'
import { MachineGroupService } from '#services/machine_group/machine_group_service'
import { runWithDomainError } from '#controllers/shared/handle_domain_error'

export default class MachineGroupsController {
  /**
   * Lista todos os grupos de máquinas.
   * GET /api/v1/machine-groups
   */
  async index({ response }: HttpContext) {
    const groups = await MachineGroupService.listGroups()
    return response.ok(groups)
  }

  /**
   * Cria um novo grupo (opcionalmente com máquinas associadas).
   * POST /api/v1/machine-groups
   */
  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(machineGroupValidator)

    return runWithDomainError(
      response,
      () => MachineGroupService.createGroup(data),
      (group) => response.created(group)
    )
  }

  /**
   * Atualiza título, descrição e/ou máquinas associadas.
   * PUT /api/v1/machine-groups/:id
   */
  async update({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(updateMachineGroupValidator)

    return runWithDomainError(
      response,
      () => MachineGroupService.updateGroup(Number(params.id), data),
      (group) => response.ok(group)
    )
  }

  /**
   * Remove um grupo. Máquinas associadas ficam sem grupo (ON DELETE SET NULL).
   * DELETE /api/v1/machine-groups/:id
   */
  async destroy({ params, response }: HttpContext) {
    await MachineGroupService.deleteGroup(Number(params.id))
    return response.noContent()
  }
}
