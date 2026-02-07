import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Allocation from '#models/allocation'

export default class Telemetry extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare allocationId: number

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

  // Sem createdAt: o ID auto-increment serve como sequência temporal (1 telemetria/segundo)

  // --- RELACIONAMENTO ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>
}