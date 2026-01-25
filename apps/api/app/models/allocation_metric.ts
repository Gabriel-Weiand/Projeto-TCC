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

  // --- DISCO ---
  @column() declare avgDiskUsage: number
  @column() declare maxDiskUsage: number

  // --- REDE ---
  @column() declare avgDownloadUsage: number
  @column() declare maxDownloadUsage: number
  @column() declare avgUploadUsage: number
  @column() declare maxUploadUsage: number

  // --- MOBO ---
  @column() declare avgMoboTemp: number
  @column() declare maxMoboTemp: number

  @column()
  declare sessionDurationMinutes: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // --- RELACIONAMENTO ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>
}
