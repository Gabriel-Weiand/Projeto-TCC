import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import { parseUtcFromIso } from '#utils/datetime'

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
    startTime: vine.string().transform((v) => parseUtcFromIso(v)),
    endTime: vine.string().transform((v) => parseUtcFromIso(v)),
    reason: vine.string().trim().maxLength(200).optional(),
    status: vine
      .enum(['pending', 'approved', 'denied', 'cancelled', 'finished'] as const)
      .optional(),

    // NOVO: Permissão de sudo
    isSudo: vine.boolean().optional(),
  })
)

export const extendAllocationValidator = vine.compile(
  vine.object({
    additionalMinutes: vine.number().min(15).max(120).optional(),
    endTime: vine.string().trim().optional(),
    reason: vine.string().trim().maxLength(200).optional(),
  })
)

/**
 * Validator para atualização de alocação.
 * Usado para cancelar, aprovar, finalizar, etc.
 */
export const updateAllocationValidator = vine.compile(
  vine.object({
    startTime: vine.string().transform((value) => parseUtcFromIso(value)).optional(),
    endTime: vine.string().transform((value) => parseUtcFromIso(value)).optional(),
    reason: vine.string().trim().maxLength(200).nullable().optional(),
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
    /** Admin: true = só ocultas pelo usuário; omitido/false = lista operacional (sem ocultas) */
    userHidden: vine.boolean().optional(),

    // Paginação
    page: vine.number().positive().optional(),
    limit: vine.number().positive().max(100).optional(),
  })
)
