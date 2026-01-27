import vine from '@vinejs/vine'

/**
 * Validator para prune de telemetrias.
 * Remove dados antigos para economizar espaço.
 */
export const pruneTelemetriesValidator = vine.compile(
  vine.object({
    // Data limite - remove registros ANTERIORES a esta data
    before: vine.date({ formats: ['iso8601'] }),

    // Opcional: limitar a uma máquina específica
    machineId: vine.number().positive().optional(),
  })
)

/**
 * Validator para prune de alocações finalizadas/canceladas.
 */
export const pruneAllocationsValidator = vine.compile(
  vine.object({
    // Data limite - remove registros ANTERIORES a esta data
    before: vine.date({ formats: ['iso8601'] }),

    // Status a remover (default: finished e cancelled)
    status: vine
      .array(vine.enum(['finished', 'cancelled', 'denied'] as const))
      .optional(),

    // Opcional: limitar a um usuário ou máquina
    userId: vine.number().positive().optional(),
    machineId: vine.number().positive().optional(),
  })
)

/**
 * Validator para prune de métricas de alocação.
 */
export const pruneMetricsValidator = vine.compile(
  vine.object({
    // Data limite
    before: vine.date({ formats: ['iso8601'] }),
  })
)
