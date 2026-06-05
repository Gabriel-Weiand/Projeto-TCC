import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import MachineGroup from '#models/machine_group'
import {
  machineGroupValidator,
  updateMachineGroupValidator,
} from '#validators/machine_group'
import { findMissingMachineIds, syncGroupMachines } from '#services/machine_group_sync'

function machinesNotFoundResponse(
  response: HttpContext['response'],
  missingIds: number[]
) {
  return response.badRequest({
    code: 'MACHINES_NOT_FOUND',
    message: 'Uma ou mais máquinas informadas não existem.',
    missingIds,
  })
}

export default class MachineGroupsController {
  /**
   * Lista todos os grupos de máquinas.
   * GET /api/v1/machine-groups
   */
  async index({ response }: HttpContext) {
    const groups = await MachineGroup.query().preload('machines').orderBy('title', 'asc')
    return response.ok(groups)
  }

  /**
   * Cria um novo grupo (opcionalmente com máquinas associadas).
   * POST /api/v1/machine-groups
   */
  async store({ request, response }: HttpContext) {
    const { machineIds, ...data } = await request.validateUsing(machineGroupValidator)

    if (machineIds && machineIds.length > 0) {
      const missingIds = await findMissingMachineIds(machineIds)
      if (missingIds.length > 0) {
        return machinesNotFoundResponse(response, missingIds)
      }
    }

    const group = await db.transaction(async (trx) => {
      const created = await MachineGroup.create(data, { client: trx })

      if (machineIds && machineIds.length > 0) {
        await syncGroupMachines(created.id, machineIds, trx)
      }

      return created
    })

    await group.load('machines')
    return response.created(group)
  }

  /**
   * Exibe um grupo específico e as máquinas que o compõem.
   * GET /api/v1/machine-groups/:id
   */
  async show({ params, response }: HttpContext) {
    const group = await MachineGroup.findOrFail(params.id)
    await group.load('machines')
    return response.ok(group)
  }

  /**
   * Atualiza título, descrição e/ou máquinas associadas.
   * PUT /api/v1/machine-groups/:id
   */
  async update({ params, request, response }: HttpContext) {
    const group = await MachineGroup.findOrFail(params.id)
    const { machineIds, ...data } = await request.validateUsing(updateMachineGroupValidator)

    if (machineIds !== undefined && machineIds.length > 0) {
      const missingIds = await findMissingMachineIds(machineIds)
      if (missingIds.length > 0) {
        return machinesNotFoundResponse(response, missingIds)
      }
    }

    await db.transaction(async (trx) => {
      if (data.title !== undefined || data.description !== undefined) {
        group.useTransaction(trx)
        group.merge(data)
        await group.save()
      }

      if (machineIds !== undefined) {
        await syncGroupMachines(group.id, machineIds, trx)
      }
    })

    await group.load('machines')
    return response.ok(group)
  }

  /**
   * Remove um grupo. Máquinas associadas ficam sem grupo (ON DELETE SET NULL).
   * DELETE /api/v1/machine-groups/:id
   */
  async destroy({ params, response }: HttpContext) {
    const group = await MachineGroup.findOrFail(params.id)
    await group.delete()
    return response.noContent()
  }
}
