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
  @column() declare cpuFreqMhz: number | null  // MHz inteiro, opcional
  @column() declare gpuUsage: number
  @column() declare gpuTemp: number
  @column() declare ramUsage: number
  @column() declare swapUsage: number | null
  @column() declare diskUsage: number | null

  // --- REDE (Mbps) - Opcional ---
  @column() declare downloadUsage: number | null
  @column() declare uploadUsage: number | null

  // --- EXTRAS ---
  @column() declare moboTemperature: number | null
  @column() declare loggedUserName: string

  // Sem createdAt: o ID auto-increment serve como sequência temporal (1 telemetria/segundo)

  // --- RELACIONAMENTO ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>
}