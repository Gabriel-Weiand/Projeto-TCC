import db from '@adonisjs/lucid/services/db'
import MachineGroup from '#models/machine_group'
import { DomainError } from '#services/shared/domain_error'
import { findMissingMachineIds, syncGroupMachines } from '#services/machine/group_sync'
import type { Infer } from '@vinejs/vine/types'
import type { machineGroupValidator, updateMachineGroupValidator } from '#validators/machine_group'

type CreateGroupPayload = Infer<typeof machineGroupValidator>
type UpdateGroupPayload = Infer<typeof updateMachineGroupValidator>

function assertMachinesExist(machineIds: number[] | undefined) {
  if (!machineIds || machineIds.length === 0) return

  return findMissingMachineIds(machineIds).then((missingIds) => {
    if (missingIds.length > 0) {
      throw new DomainError(
        'MACHINES_NOT_FOUND',
        'Uma ou mais máquinas informadas não existem.',
        400,
        { missingIds }
      )
    }
  })
}

export const MachineGroupService = {
  async listGroups() {
    return MachineGroup.query().preload('machines').orderBy('title', 'asc')
  },

  async createGroup(data: CreateGroupPayload) {
    const { machineIds, ...groupData } = data
    await assertMachinesExist(machineIds)

    const group = await db.transaction(async (trx) => {
      const created = await MachineGroup.create(groupData, { client: trx })

      if (machineIds && machineIds.length > 0) {
        await syncGroupMachines(created.id, machineIds, trx)
      }

      return created
    })

    await group.load('machines')
    return group
  },

  async updateGroup(groupId: number, data: UpdateGroupPayload) {
    const group = await MachineGroup.findOrFail(groupId)
    const { machineIds, ...patch } = data

    if (machineIds !== undefined && machineIds.length > 0) {
      await assertMachinesExist(machineIds)
    }

    await db.transaction(async (trx) => {
      if (patch.title !== undefined || patch.description !== undefined) {
        group.useTransaction(trx)
        group.merge(patch)
        await group.save()
      }

      if (machineIds !== undefined) {
        await syncGroupMachines(group.id, machineIds, trx)
      }
    })

    await group.load('machines')
    return group
  },

  async deleteGroup(groupId: number) {
    const group = await MachineGroup.findOrFail(groupId)
    await group.delete()
  },
}
