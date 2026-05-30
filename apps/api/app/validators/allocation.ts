import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

/**
 * Transforma Date para DateTime do Luxon.
 */
vine.messagesProvider

/**
 * Validator para criação de alocação (reserva).
 * Nota: userId é tratado no controller (vem do auth para users normais)
 */
export const createAllocationValidator = vine.compile(
  vine.object({
    userId: vine.number().positive().optional(),
    machineId: vine.number().positive(),
    startTime: vine.date({ formats: ['iso8601'] }).transform((v) => DateTime.fromJSDate(v)),
    endTime: vine.date({ formats: ['iso8601'] }).transform((v) => DateTime.fromJSDate(v)),
    reason: vine.string().trim().maxLength(255).optional(),
    status: vine
      .enum(['pending', 'approved', 'denied', 'cancelled', 'finished'] as const)
      .optional(),

    // NOVO: Permissão de sudo
    isSudo: vine.boolean().optional(),
  })
)

export const extendAllocationValidator = vine.compile(
  vine.object({
    // Quantidade de minutos que o usuário está pedindo a mais
    additionalMinutes: vine.number().min(15).max(120),
    reason: vine.string().trim().maxLength(255).optional(),
  })
)

/**
 * Validator para atualização de alocação.
 * Usado para cancelar, aprovar, finalizar, etc.
 */
export const updateAllocationValidator = vine.compile(
  vine.object({
    startTime: vine
      .date({ formats: ['iso8601'] })
      .transform((value) => DateTime.fromJSDate(value))
      .optional(),
    endTime: vine
      .date({ formats: ['iso8601'] })
      .transform((value) => DateTime.fromJSDate(value))
      .optional(),
    reason: vine.string().trim().maxLength(255).nullable().optional(),
    status: vine
      .enum(['pending', 'approved', 'denied', 'cancelled', 'finished'] as const)
      .optional(),
  })
)

/**
 * Validator para query params de listagem de alocações.
 */
export const listAllocationsValidator = vine.compile(
  vine.object({
    // Filtros
    userId: vine.number().positive().optional(),
    machineId: vine.number().positive().optional(),
    status: vine
      .enum(['pending', 'approved', 'denied', 'cancelled', 'finished'] as const)
      .optional(),

    // Paginação
    page: vine.number().positive().optional(),
    limit: vine.number().positive().max(100).optional(),
  })
)
