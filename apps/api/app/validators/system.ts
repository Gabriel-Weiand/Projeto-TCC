import vine from '@vinejs/vine'

/**
 * Validator para prune de notificações (createdAt anterior ao corte).
 */
export const pruneNotificationsValidator = vine.compile(
  vine.object({
    before: vine.date({ formats: ['iso8601'] }).optional(),
    userId: vine.number().positive().optional(),
  })
)

/**
 * Validator para prune de tentativas SSH (mantém últimos N dias).
 */
export const pruneSshAttemptsValidator = vine.compile(
  vine.object({
    keepDays: vine.number().positive().optional(),
    machineId: vine.number().positive().optional(),
  })
)
