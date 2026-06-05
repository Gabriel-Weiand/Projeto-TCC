import vine from '@vinejs/vine'

export const updateLabSettingsValidator = vine.compile(
  vine.object({
    requireAdminApproval: vine.boolean().optional(),
    publicNames: vine.boolean().optional(),
  })
)
