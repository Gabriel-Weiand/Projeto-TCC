import vine from '@vinejs/vine'

const telemetrySetSchema = vine.object({
  cpu: vine.boolean().optional(),
  gpu: vine.boolean().optional(),
  ramAndSwap: vine.boolean().optional(),
  diskSpace: vine.boolean().optional(),
  diskIO: vine.boolean().optional(),
  networkIO: vine.boolean().optional(),
  temperatures: vine.boolean().optional(),
  activeUsers: vine.boolean().optional(),
})

const presetProfileSchema = vine.object({
  intervalSeconds: vine.number().min(10).max(300),
  batchSize: vine.number().min(1).max(15),
  telemetrySet: telemetrySetSchema,
})

export const updateLabTelemetryPresetsValidator = vine.compile(
  vine.object({
    fast: presetProfileSchema,
    eco: presetProfileSchema,
  })
)
