import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Allocation from '#models/allocation'

export default class AllocationMetric extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare allocationId: number

  // --- CPU ---
  @column() declare avgCpuUsage: number
  @column() declare maxCpuUsage: number
  @column() declare avgCpuTemp: number
  @column() declare maxCpuTemp: number

  // --- GPU ---
  @column() declare avgGpuUsage: number
  @column() declare maxGpuUsage: number
  @column() declare avgGpuTemp: number
  @column() declare maxGpuTemp: number
  @column() declare avgGpuPowerWatts: number | null
  @column() declare maxGpuPowerWatts: number | null
  @column() declare avgVramTotalGb: number | null
  @column() declare maxVramTotalGb: number | null
  @column() declare avgVramUsedGb: number | null
  @column() declare maxVramUsedGb: number | null

  // --- RAM E SWAP ---
  @column() declare avgRamUsedGb: number | null
  @column() declare maxRamUsedGb: number | null
  @column() declare avgSwapUsedGb: number | null
  @column() declare maxSwapUsedGb: number | null

  // --- DISCO ---
  @column() declare avgDiskReadMbps: number | null
  @column() declare maxDiskReadMbps: number | null
  @column() declare avgDiskWriteMbps: number | null
  @column() declare maxDiskWriteMbps: number | null

  // --- REDE ---
  @column() declare avgDownloadMbps: number | null
  @column() declare maxDownloadMbps: number | null
  @column() declare avgUploadMbps: number | null
  @column() declare maxUploadMbps: number | null

  // --- MOBO ---
  @column() declare avgMoboTemp: number | null
  @column() declare maxMoboTemp: number | null

  @column()
  declare sessionDurationMinutes: number

  /** Largura de cada ponto do gráfico (minutos), adaptada à duração da sessão. */
  @column()
  declare chartBucketMinutes: number

  @column({
    prepare: (value: unknown) => (value == null ? null : JSON.stringify(value)),
    consume: (value: unknown) => {
      if (value == null) return null
      if (typeof value === 'string') return JSON.parse(value)
      return value
    },
  })
  declare chartSeries: Record<string, unknown>[] | null

  /** Resumo agregado por (pid, name) — wire format (cpu/gpu ×10). */
  @column({
    prepare: (value: unknown) => (value == null ? null : JSON.stringify(value)),
    consume: (value: unknown) => {
      if (value == null) return null
      if (typeof value === 'string') return JSON.parse(value)
      return value
    },
  })
  declare processSummary: Record<string, unknown>[] | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // --- RELACIONAMENTO ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>
}
