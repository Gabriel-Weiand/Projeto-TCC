import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Machine from '#models/machine'

export default class Telemetry extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare machineId: number

  // --- HARDWARE (Escala 0-1000) ---
  @column() declare cpuUsage: number
  @column() declare cpuTemp: number
  @column() declare gpuUsage: number
  @column() declare gpuTemp: number
  @column() declare ramUsage: number
  @column() declare diskUsage: number

  // --- REDE (Mbps) ---
  @column() declare downloadUsage: number
  @column() declare uploadUsage: number

  // --- EXTRAS ---
  @column() declare moboTemperature: number | null
  @column() declare loggedUserName: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // --- RELACIONAMENTO ---
  @belongsTo(() => Machine)
  declare machine: BelongsTo<typeof Machine>
}