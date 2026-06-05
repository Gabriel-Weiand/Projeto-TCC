import vine from '@vinejs/vine'

const machineGroupFields = {
  title: vine.string().trim().minLength(3).maxLength(80),
  description: vine.string().trim().maxLength(255).optional().nullable(),
  /** IDs das máquinas que devem pertencer a este grupo (substitui associação atual). */
  machineIds: vine.array(vine.number().positive()).optional(),
}

export const machineGroupValidator = vine.compile(vine.object(machineGroupFields))

export const updateMachineGroupValidator = vine.compile(
  vine.object({
    title: machineGroupFields.title.optional(),
    description: machineGroupFields.description,
    machineIds: machineGroupFields.machineIds,
  })
)
