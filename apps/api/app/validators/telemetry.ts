import vine from '@vinejs/vine'

/**
 * Dataset LEAN — campos escalares compactos.
 * Persiste no banco (tabela telemetries) e serve de base para allocation_metrics.
 * Todos os valores de % estão em escala 0–1000 (divide por 10 para obter %).
 * Temperaturas em escala 0–1500 (divide por 10 para obter °C).
 */
const leanSchema = vine.object({
  // CPU
  cpuUsage: vine.number().min(0).max(1000),
  cpuTemp: vine.number().min(0).max(1500),
  cpuFreqMhz: vine.number().min(0).optional(), // Frequência média em MHz

  // GPU
  gpuUsage: vine.number().min(0).max(1000),
  gpuTemp: vine.number().min(0).max(1500),

  // Memória
  ramUsage: vine.number().min(0).max(1000),
  swapUsage: vine.number().min(0).max(1000).nullable().optional(),

  // Disco
  diskUsage: vine.number().min(0).max(1000).nullable().optional(),
  diskReadMbps: vine.number().min(0).nullable().optional(),
  diskWriteMbps: vine.number().min(0).nullable().optional(),

  // Rede (Mbps)
  downloadUsage: vine.number().min(0).nullable().optional(),
  uploadUsage: vine.number().min(0).nullable().optional(),

  // Extras
  moboTemperature: vine.number().min(0).max(1500).nullable().optional(),
  loggedUserName: vine.string().trim().maxLength(100),
})

/**
 * Dataset RICH — dados granulares por core.
 * Mantido apenas em memória (ring buffer) para o dashboard real-time.
 * Não é persistido no banco.
 */
const richSchema = vine.object({
  // Tudo do lean, mais:
  cpuUsage: vine.number().min(0).max(1000),
  cpuTemp: vine.number().min(0).max(1500),
  cpuFreqMhz: vine.number().min(0).optional(),
  gpuUsage: vine.number().min(0).max(1000),
  gpuTemp: vine.number().min(0).max(1500),
  ramUsage: vine.number().min(0).max(1000),
  swapUsage: vine.number().min(0).max(1000).nullable().optional(),
  diskUsage: vine.number().min(0).max(1000).nullable().optional(),
  diskReadMbps: vine.number().min(0).nullable().optional(),
  diskWriteMbps: vine.number().min(0).nullable().optional(),
  downloadUsage: vine.number().min(0).nullable().optional(),
  uploadUsage: vine.number().min(0).nullable().optional(),
  moboTemperature: vine.number().min(0).max(1500).nullable().optional(),
  loggedUserName: vine.string().trim().maxLength(100),

  // Granular por core (arrays)
  cpuCoreUsage: vine.array(vine.number().min(0).max(1000)).optional(),
  cpuCoreFreqMhz: vine.array(vine.number().min(0)).optional(),

  // Memória detalhada
  ramAvailableGb: vine.number().min(0).optional(),
  ramTotalGb: vine.number().min(0).optional(),

  // NVMe
  nvmeTemp: vine.number().min(0).max(1500).nullable().optional(),

  // Espaço livre em disco
  diskFreeGb: vine.number().min(0).nullable().optional(),
  diskTotalGb: vine.number().min(0).nullable().optional(),

  // Top processos por CPU [{pid, name, cpuPct, ramPct}]
  topProcesses: vine.array(
    vine.object({
      pid: vine.number(),
      name: vine.string().trim().maxLength(128),
      cpuPct: vine.number().min(0),
      ramPct: vine.number().min(0),
    })
  ).optional(),
})

/**
 * Payload completo enviado pelo agente — contém lean + rich aninhados.
 */
export const telemetryReportValidator = vine.compile(
  vine.object({
    lean: leanSchema,
    rich: richSchema,
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
