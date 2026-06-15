import type { HttpContext } from '@adonisjs/core/http'
import {
  createMachineValidator,
  updateMachineValidator,
  updateProvisionedUserValidator,
  createProvisionedUserValidator,
} from '#validators/machine'
import { MachineService } from '#services/machine/machine_service'

export default class MachinesController {
  async index({ response }: HttpContext) {
    const machines = await MachineService.listMachines()
    return response.ok(machines)
  }

  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(createMachineValidator)
    const machine = await MachineService.createMachine(data)
    return response.created(machine)
  }

  async show({ params, response }: HttpContext) {
    const machine = await MachineService.getMachine(Number(params.id))
    return response.ok(machine)
  }

  async update({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(updateMachineValidator)
    const result = await MachineService.updateMachine(Number(params.id), data)
    return response.ok(result)
  }

  async destroy({ params, response }: HttpContext) {
    const result = await MachineService.deleteMachine(Number(params.id))

    if (result.decommissioning) {
      return response.accepted({
        status: result.status,
        message: result.message,
        cancelledAllocations: result.cancelledAllocations,
      })
    }

    return response.noContent()
  }

  async telemetry({ params, request, response }: HttpContext) {
    const { page = 1, limit = 100 } = request.qs()
    const result = await MachineService.getMachineTelemetry(
      Number(params.id),
      Number(page),
      Number(limit)
    )
    return response.ok(result)
  }

  async regenerateToken({ params, response }: HttpContext) {
    const result = await MachineService.regenerateToken(Number(params.id))
    return response.ok(result)
  }

  async telemetryStream({ params, request, response }: HttpContext) {
    const { count } = request.qs()
    const result = await MachineService.getTelemetryStream(
      Number(params.id),
      count ? Number(count) : undefined
    )
    return response.ok(result)
  }

  async provisionedUsers({ params, response }: HttpContext) {
    const rows = await MachineService.listProvisionedUsers(Number(params.id))
    return response.ok(rows)
  }

  async storeProvisionedUser({ params, request, response }: HttpContext) {
    const { userId, accessType } = await request.validateUsing(createProvisionedUserValidator)
    const rows = await MachineService.createProvisionedUser(
      Number(params.id),
      userId,
      accessType ?? 'shell'
    )
    return response.created(rows)
  }

  async updateProvisionedUser({ params, request, response }: HttpContext) {
    const { accessType } = await request.validateUsing(updateProvisionedUserValidator)
    const rows = await MachineService.updateProvisionedUser(
      Number(params.id),
      Number(params.userId),
      accessType ?? 'auto'
    )
    return response.ok(rows)
  }

  async destroyProvisionedUser({ params, response }: HttpContext) {
    await MachineService.deleteProvisionedUser(Number(params.id), Number(params.userId))
    return response.noContent()
  }
}
