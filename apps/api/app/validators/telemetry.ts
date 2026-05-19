import vine from '@vinejs/vine'

/**
 * Schema único para um item de telemetria.
 * Todos os valores de % estão em escala 0–1000 (divide por 10 para obter %).
 * Temperaturas em escala 0–1500 (divide por 10 para obter °C).
 */
const telemetrySchema = vine.object({
  timestamp: vine.string(),

  // CPU e GPU
  cpuUsage: vine.number().min(0).max(1000),
  cpuTemp: vine.number().min(0).max(1500),
  cpuFreqMhz: vine.number().min(0).nullable().optional(),
  gpuUsage: vine.number().min(0).max(1000),
  gpuTemp: vine.number().min(0).max(1500),

  // Memória e Swap (% e Valores Absolutos em GB*10)
  ramTotalGb: vine.number().min(0).nullable().optional(),
  ramUsedGb: vine.number().min(0).nullable().optional(),
  swapTotalGb: vine.number().min(0).nullable().optional(),
  swapUsedGb: vine.number().min(0).nullable().optional(),

  // Discos e I/O
  disks: vine
    .array(
      vine.object({
        mountpoint: vine.string(),
        usagePct: vine.number().min(0).max(1000),
        freeGb: vine.number().min(0),
        readMbps: vine.number().min(0),
        writeMbps: vine.number().min(0),
      })
    )
    .nullable()
    .optional(),
  diskReadMbps: vine.number().min(0).nullable().optional(),
  diskWriteMbps: vine.number().min(0).nullable().optional(),

  // Rede (Mbps)
  downloadMbps: vine.number().min(0).nullable().optional(),
  uploadMbps: vine.number().min(0).nullable().optional(),

  // Extras
  moboTemperature: vine.number().min(0).max(1500).nullable().optional(),

  // Usuários Ativos
  activeUsers: vine
    .array(
      vine.object({
        username: vine.string(),
        terminal: vine.string().optional(),
        host: vine.string(),
        isSsh: vine.boolean(),
        connectedSince: vine.number(),
      })
    )
    .nullable()
    .optional(),
})

/**
 * Payload completo enviado pelo agente — Agora espera um array (Lote) dentro de "data".
 */
export const telemetryReportValidator = vine.compile(
  vine.object({
    data: vine.array(telemetrySchema),
  })
)

/**
 * Validator para query params de listagem de telemetria.
 */
export const listTelemetryValidator = vine.compile(
  vine.object({
    // Período
    startDate: vine.date({ formats: ['iso8601'] }).optional(),
    endDate: vine.date({ formats: ['iso8601'] }).optional(),

    // Paginação
    page: vine.number().positive().optional(),
    limit: vine.number().positive().max(1000).optional(),
  })
)
