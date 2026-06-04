import vine from '@vinejs/vine'

/**
 * Validator para criação de máquina.
 * Token é gerado automaticamente pelo Model.
 */
export const createMachineValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(50),
    description: vine.string().trim().maxLength(255),

    // Hardware specs (opcionais - podem ser preenchidos depois pelo agente)
    cpuModel: vine.string().trim().maxLength(100).optional(),
    gpuModel: vine.string().trim().maxLength(100).optional(),
    totalVramGb: vine.number().withoutDecimals().min(0).max(10240).optional(),
    totalRamGb: vine.number().withoutDecimals().min(1).max(10240).optional(),

    // Rede (opcionais)
    ipAddress: vine.string().trim().maxLength(45).optional(),
    /** omitido ou null = porta 22 */
    sshPort: vine.number().withoutDecimals().min(1).max(65535).nullable().optional(),

    // Status inicial
    status: vine.enum(['available', 'offline', 'maintenance'] as const).optional(),
    telemetryPreset: vine.enum(['fast', 'eco', 'custom'] as const).optional(),
  })
)

/**
 * Validator para atualização de máquina via painel/sync_specs.
 */
export const updateMachineValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(50).optional(),
    description: vine.string().trim().maxLength(255).optional(),

    // Adicionado para permitir edição
    machineGroupId: vine.number().positive().nullable().optional(),

    cpuModel: vine.string().trim().maxLength(100).nullable().optional(),
    gpuModel: vine.string().trim().maxLength(100).nullable().optional(),
    totalVramGb: vine.number().withoutDecimals().min(0).max(10240).nullable().optional(),
    totalRamGb: vine.number().withoutDecimals().min(1).max(10240).nullable().optional(),

    ipAddress: vine.string().trim().maxLength(45).nullable().optional(),
    sshPort: vine.number().withoutDecimals().min(1).max(65535).nullable().optional(),

    status: vine.enum(['available', 'offline', 'maintenance'] as const).optional(),

    // Adicionado para permitir mudança de plano de telemetria
    telemetryPreset: vine.enum(['fast', 'eco', 'custom'] as const).optional(),

    customAgentConfig: vine
      .object({
        intervalSeconds: vine.number().min(1).max(600).optional(),
        batchSize: vine.number().min(1).max(15).optional(),

        // Configuração padrão de captura contínua de processos
        processThresholds: vine
          .object({
            cpuPercent: vine.number().min(0).max(100).optional(),
            ramMb: vine.number().min(0).optional(),
            vramMb: vine.number().min(0).optional(),
            diskReadKbps: vine.number().min(0).optional(), // <-- Separado
            diskWriteKbps: vine.number().min(0).optional(), // <-- Separado
            topX: vine.number().min(1).max(50).optional(),
          })
          .optional(),

        telemetrySet: vine
          .object({
            cpu: vine.boolean().optional(),
            gpu: vine.boolean().optional(),
            ramAndSwap: vine.boolean().optional(),
            diskSpace: vine.boolean().optional(),
            diskIO: vine.boolean().optional(),
            networkIO: vine.boolean().optional(),
            temperatures: vine.boolean().optional(),
            activeUsers: vine.boolean().optional(),
          })
          .optional(),
      })
      .optional()
      .nullable(),
  })
)

export const requestProcessReportValidator = vine.compile(
  vine.object({
    cpuPercent: vine.number().min(0).max(100).optional(), // Ex: > 2%
    ramMb: vine.number().min(0).optional(), // Ex: > 200 MB
    vramMb: vine.number().min(0).optional(), // Ex: > 50 MB
    diskReadKbps: vine.number().min(0).optional(), // Ex: > 500 Kbps
    diskWriteKbps: vine.number().min(0).optional(), // Ex: > 500 Kbps
    topX: vine.number().min(1).max(50).optional(), // Ex: Top 10
  })
)
