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
    totalDiskGb: vine.number().withoutDecimals().min(1).max(10240).optional(),

    // Rede (opcionais)
    ipAddress: vine.string().trim().maxLength(45).optional(),
    publicIpAddress: vine.string().trim().maxLength(45).optional(),
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
    totalDiskGb: vine.number().withoutDecimals().min(1).max(10240).nullable().optional(),

    ipAddress: vine.string().trim().maxLength(45).nullable().optional(),
    publicIpAddress: vine.string().trim().maxLength(45).nullable().optional(),
    onlyMainDisk: vine.boolean().optional(),

    disks: vine
      .array(
        vine.object({
          device: vine.string().trim().maxLength(128),
          mountpoint: vine.string().trim().maxLength(255),
          fstype: vine.string().trim().maxLength(32).nullable().optional(),
          totalGb: vine.number().min(0).nullable().optional(),
          freeGb: vine.number().min(0).nullable().optional(),
          role: vine.enum(['system', 'user'] as const).optional(),
          mainDisk: vine.boolean().optional(),
          allocatable: vine.boolean().optional(),
        })
      )
      .maxLength(32)
      .optional(),
    sshPort: vine.number().withoutDecimals().min(1).max(65535).nullable().optional(),

    status: vine.enum(['available', 'offline', 'maintenance'] as const).optional(),

    // Adicionado para permitir mudança de plano de telemetria
    telemetryPreset: vine.enum(['fast', 'eco', 'custom'] as const).optional(),

    customAgentConfig: vine
      .object({
        intervalSeconds: vine.number().min(2).max(300).optional(),
        batchSize: vine.number().min(1).max(15).optional(),

        // Configuração padrão de captura contínua de processos
        processThresholds: vine
          .object({
            cpuPercent: vine.number().min(0).max(100).optional(),
            ramMb: vine.number().min(0).optional(),
            vramMb: vine.number().min(0).optional(),
            diskReadKbps: vine.number().min(0).optional(), // <-- Separado
            diskWriteKbps: vine.number().min(0).optional(), // <-- Separado
            topX: vine.number().min(1).max(100).optional(),
          })
          .optional(),

        processCaptureConfig: vine
          .object({
            compareMetric: vine
              .enum([
                'cpuPercent',
                'ramMb',
                'vramMb',
                'gpuUse',
                'diskReadKbps',
                'diskWriteKbps',
              ] as const)
              .optional(),
            topX: vine.number().min(1).max(100).optional(),
            userScope: vine.enum(['session', 'all'] as const).optional(),
          })
          .optional(),

        telemetrySet: vine
          .object({
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
          .optional(),
      })
      .optional()
      .nullable(),
  })
)

export const updateProvisionedUserValidator = vine.compile(
  vine.object({
    accessType: vine.enum(['auto', 'shell', 'sftp', 'revoked'] as const).optional(),
  })
)

export const createProvisionedUserValidator = vine.compile(
  vine.object({
    userId: vine.number().positive(),
    accessType: vine.enum(['shell', 'sftp', 'revoked'] as const).optional(),
  })
)

export const requestProcessReportValidator = vine.compile(
  vine.object({
    compareMetric: vine
      .enum(['cpuPercent', 'ramMb', 'vramMb', 'gpuUse', 'diskReadKbps', 'diskWriteKbps'] as const)
      .optional(),
    topX: vine.number().min(1).max(100).optional(),
    userScope: vine.enum(['session', 'all'] as const).optional(),
  })
)
