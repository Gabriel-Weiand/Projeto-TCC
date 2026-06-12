import vine from '@vinejs/vine'

const telemetrySetSchema = vine.object({
  cpu: vine.boolean().optional(),
  gpu: vine.boolean().optional(),
  ramAndSwap: vine.boolean().optional(),
  disk: vine.boolean().optional(),
  diskSpace: vine.boolean().optional(),
  diskIO: vine.boolean().optional(),
  networkIO: vine.boolean().optional(),
  temperatures: vine.boolean().optional(),
  activeUsers: vine.boolean().optional(),
  processCapture: vine.boolean().optional(),
})

const processCaptureConfigSchema = vine.object({
  compareMetric: vine
    .enum(['cpuPercent', 'ramMb', 'vramMb', 'gpuUse', 'diskReadKbps', 'diskWriteKbps'] as const)
    .optional(),
  topX: vine.number().min(1).max(100).optional(),
  userScope: vine.enum(['session', 'all'] as const).optional(),
})

const presetProfileSchema = vine.object({
  intervalSeconds: vine.number().min(10).max(300),
  batchSize: vine.number().min(1).max(15),
  telemetrySet: telemetrySetSchema,
  processCaptureConfig: processCaptureConfigSchema.optional(),
})

export const updateLabTelemetryPresetsValidator = vine.compile(
  vine.object({
    fast: presetProfileSchema,
    eco: presetProfileSchema,
  })
)
