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
    userId: vine.number().positive().optional(), // Opcional: Admin pode especificar, user normal usa auth
    machineId: vine.number().positive(),

    // Datas no formato ISO 8601 - transformadas para DateTime
    startTime: vine
      .date({ formats: ['iso8601'] })
      .transform((value) => DateTime.fromJSDate(value)),
    endTime: vine
      .date({ formats: ['iso8601'] })
      .transform((value) => DateTime.fromJSDate(value)),

    reason: vine.string().trim().maxLength(255).optional(),

    // Status (default é 'approved' no banco)
    status: vine
      .enum(['pending', 'approved', 'denied', 'cancelled', 'finished'] as const)
      .optional(),
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
