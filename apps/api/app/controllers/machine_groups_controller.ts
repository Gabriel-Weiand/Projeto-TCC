import type { HttpContext } from '@adonisjs/core/http'
import {
  machineGroupValidator,
  updateMachineGroupValidator,
} from '#validators/machine_group'
import { MachineGroupService } from '#services/machine_group/machine_group_service'

export default class MachineGroupsController {
  async index({ response }: HttpContext) {
    const groups = await MachineGroupService.listGroups()
    return response.ok(groups)
  }

  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(machineGroupValidator)
    const group = await MachineGroupService.createGroup(data)
    return response.created(group)
  }

  async update({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(updateMachineGroupValidator)
    const group = await MachineGroupService.updateGroup(Number(params.id), data)
    return response.ok(group)
  }

  async destroy({ params, response }: HttpContext) {
    await MachineGroupService.deleteGroup(Number(params.id))
    return response.noContent()
  }
}
