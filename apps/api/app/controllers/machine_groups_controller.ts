import type { HttpContext } from '@adonisjs/core/http'
import MachineGroup from '#models/machine_group'
import { machineGroupValidator } from '#validators/machine_group'

export default class MachineGroupsController {
  /**
   * Lista todos os grupos de máquinas.
   * GET /api/v1/admin/machine-groups
   */
  async index({ response }: HttpContext) {
    // Traz os grupos já contando as máquinas embutidas
    const groups = await MachineGroup.query().preload('machines').orderBy('title', 'asc')
    return response.ok(groups)
  }

  /**
   * Cria um novo grupo.
   * POST /api/v1/admin/machine-groups
   */
  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(machineGroupValidator)
    const group = await MachineGroup.create(data)

    return response.created(group)
  }

  /**
   * Exibe um grupo específico e as máquinas que o compõem.
   * GET /api/v1/admin/machine-groups/:id
   */
  async show({ params, response }: HttpContext) {
    const group = await MachineGroup.findOrFail(params.id)
    await group.load('machines')

    return response.ok(group)
  }

  /**
   * Atualiza as informações de um grupo.
   * PUT /api/v1/admin/machine-groups/:id
   */
  async update({ params, request, response }: HttpContext) {
    const group = await MachineGroup.findOrFail(params.id)
    const data = await request.validateUsing(machineGroupValidator)

    group.merge(data)
    await group.save()

    return response.ok(group)
  }

  /**
   * Remove um grupo.
   * As máquinas associadas a este grupo terão a coluna 'machine_group_id'
   * definida automaticamente como NULL graças ao 'ON DELETE SET NULL' na migration.
   * DELETE /api/v1/admin/machine-groups/:id
   */
  async destroy({ params, response }: HttpContext) {
    const group = await MachineGroup.findOrFail(params.id)
    await group.delete()

    return response.noContent()
  }
}
