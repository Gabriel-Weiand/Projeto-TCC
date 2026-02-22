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

  // --- RAM ---
  @column() declare avgRamUsage: number
  @column() declare maxRamUsage: number

  // --- DISCO (nullable: nem sempre disponível) ---
  @column() declare avgDiskUsage: number | null
  @column() declare maxDiskUsage: number | null

  // --- REDE (nullable: nem sempre disponível) ---
  @column() declare avgDownloadUsage: number | null
  @column() declare maxDownloadUsage: number | null
  @column() declare avgUploadUsage: number | null
  @column() declare maxUploadUsage: number | null

  // --- MOBO (nullable: nem sempre disponível) ---
  @column() declare avgMoboTemp: number | null
  @column() declare maxMoboTemp: number | null

  @column()
  declare sessionDurationMinutes: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // --- RELACIONAMENTO ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>
}
