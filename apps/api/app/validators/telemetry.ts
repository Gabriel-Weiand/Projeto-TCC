import vine from '@vinejs/vine'

const processSchema = vine.object({
  pid: vine.number().positive(),
  name: vine.string().maxLength(128),
  username: vine.string().maxLength(64),
  cpuPercent: vine.number().min(0).max(1000), // * 10
  ramMb: vine.number().min(0),
  vramMb: vine.number().min(0).optional(),
  diskReadKbps: vine.number().min(0).optional(),
  diskWriteKbps: vine.number().min(0).optional(),
})

/**
 * Todos os valores de % estão em escala 0–1000 (divide por 10 para obter %).
 * Temperaturas em escala 0–1500 (divide por 10 para obter °C).
 */

const telemetrySchema = vine.object({
  timestamp: vine.string(),

  // CPU e GPU — null quando métrica não coletada; 0 é valor válido
  cpuUsage: vine.number().min(0).max(1000).nullable().optional(),
  cpuTemp: vine.number().min(0).max(1500).nullable().optional(),
  cpuFreqMhz: vine.number().min(0).nullable().optional(),
  gpuUsage: vine.number().min(0).max(1000).nullable().optional(),
  gpuTemp: vine.number().min(0).max(1500).nullable().optional(),
  gpuPowerWatts: vine.number().min(0).nullable().optional(),

  // ATUALIZADO PARA GB
  vramTotalGb: vine.number().min(0).nullable().optional(),
  vramUsedGb: vine.number().min(0).nullable().optional(),

  ramTotalGb: vine.number().min(0).nullable().optional(),
  ramUsedGb: vine.number().min(0).nullable().optional(),
  swapTotalGb: vine.number().min(0).nullable().optional(),
  swapUsedGb: vine.number().min(0).nullable().optional(),

  disksInfo: vine.array(vine.any()).nullable().optional(),
  diskReadMbps: vine.number().min(0).nullable().optional(),
  diskWriteMbps: vine.number().min(0).nullable().optional(),
  downloadMbps: vine.number().min(0).nullable().optional(),
  uploadMbps: vine.number().min(0).nullable().optional(),
  moboTemperature: vine.number().min(0).max(1500).nullable().optional(),
  activeUsers: vine.array(vine.any()).nullable().optional(),

  // NOVO: Processos customizados capturados pelo Agente
  processes: vine.array(processSchema).nullable().optional(),
})

/**
 * Payload completo enviado pelo agente — Agora espera um array (Lote) dentro de "data".
 */
export const telemetryReportValidator = vine.compile(
  vine.object({
    data: vine.array(telemetrySchema).minLength(1).maxLength(15),
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
