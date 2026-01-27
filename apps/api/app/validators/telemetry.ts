import vine from '@vinejs/vine'

/**
 * Validator para dados de telemetria enviados pelo agente.
 * Valores em escala 0-1000 (0.0% a 100.0%).
 */
export const telemetryReportValidator = vine.compile(
  vine.object({
    // CPU
    cpuUsage: vine.number().min(0).max(1000),
    cpuTemp: vine.number().min(0).max(1500), // Até 150.0°C

    // GPU
    gpuUsage: vine.number().min(0).max(1000),
    gpuTemp: vine.number().min(0).max(1500),

    // Memória e Disco (%)
    ramUsage: vine.number().min(0).max(1000),
    diskUsage: vine.number().min(0).max(1000),

    // Rede (Mbps - sem limite rígido)
    downloadUsage: vine.number().min(0),
    uploadUsage: vine.number().min(0),

    // Extras (opcionais)
    moboTemperature: vine.number().min(0).max(1500).nullable().optional(),
    loggedUserName: vine.string().trim().maxLength(100).nullable().optional(),
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
