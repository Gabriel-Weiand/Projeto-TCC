import vine from '@vinejs/vine'

export const updateLabSettingsValidator = vine.compile(
  vine.object({
    requireAdminApproval: vine.enum(['auto', 'true', 'false'] as const).optional(),
    publicNames: vine.enum(['auto', 'true', 'false'] as const).optional(),
  })
)
