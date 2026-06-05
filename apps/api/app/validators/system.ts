import vine from '@vinejs/vine'
import { TERMINAL_ALLOCATION_STATUSES } from '#services/lab_maintenance'

/**
 * Validator para prune de alocações terminais (endTime anterior ao corte).
 * Sem `before`, usa LAB_PRUNE_ALLOCATION_DAYS a partir de endTime.
 */
export const pruneAllocationsValidator = vine.compile(
  vine.object({
    before: vine.date({ formats: ['iso8601'] }).optional(),
    status: vine.array(vine.enum(TERMINAL_ALLOCATION_STATUSES)).optional(),
    userId: vine.number().positive().optional(),
    machineId: vine.number().positive().optional(),
  })
)

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
