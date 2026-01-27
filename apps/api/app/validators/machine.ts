import vine from '@vinejs/vine'

/**
 * Validator para criação de máquina.
 * Token é gerado automaticamente pelo Model.
 */
export const createMachineValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(50),
    description: vine.string().trim().maxLength(255).optional(),

    // Hardware specs (opcionais - podem ser preenchidos depois pelo agente)
    cpuModel: vine.string().trim().maxLength(100).optional(),
    gpuModel: vine.string().trim().maxLength(100).optional(),
    totalRamGb: vine.number().positive().max(1024).optional(),
    totalDiskGb: vine.number().positive().max(100000).optional(),

    // Rede (opcionais)
    ipAddress: vine.string().trim().maxLength(45).optional(),
    macAddress: vine
      .string()
      .trim()
      .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)
      .optional(),

    // Status inicial
    status: vine
      .enum(['available', 'occupied', 'maintenance', 'offline'] as const)
      .optional(),
  })
)

/**
 * Validator para atualização de máquina.
 * Todos os campos são opcionais.
 */
export const updateMachineValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(50).optional(),
    description: vine.string().trim().maxLength(255).nullable().optional(),

    cpuModel: vine.string().trim().maxLength(100).nullable().optional(),
    gpuModel: vine.string().trim().maxLength(100).nullable().optional(),
    totalRamGb: vine.number().positive().max(1024).nullable().optional(),
    totalDiskGb: vine.number().positive().max(100000).nullable().optional(),

    ipAddress: vine.string().trim().maxLength(45).nullable().optional(),
    macAddress: vine
      .string()
      .trim()
      .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)
      .nullable()
      .optional(),

    status: vine
      .enum(['available', 'occupied', 'maintenance', 'offline'] as const)
      .optional(),
  })
)
