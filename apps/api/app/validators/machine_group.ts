import vine from '@vinejs/vine'

export const machineGroupValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(3).maxLength(80),
    description: vine.string().trim().maxLength(255).optional().nullable(),
  })
)
