import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Allocation from '#models/allocation'

export default class Telemetry extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare allocationId: number

  @column()
  declare timestamp: string

  // --- HARDWARE (Escala 0-1000) — null = métrica não coletada nesta amostra ---
  @column() declare cpuUsage: number | null
  @column() declare cpuTemp: number | null
  @column() declare cpuFreqMhz: number | null // MHz inteiro, opcional
  @column() declare gpuUsage: number | null
  @column() declare gpuTemp: number | null
  @column() declare gpuPowerWatts: number | null
  @column() declare vramTotalGb: number | null
  @column() declare vramUsedGb: number | null

  // Valores absolutos (GB * 10)
  @column() declare ramTotalGb: number | null
  @column() declare ramUsedGb: number | null
  @column() declare swapTotalGb: number | null
  @column() declare swapUsedGb: number | null

  // --- DISCO E I/O ---
  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: string) => JSON.parse(value),
  })
  declare disksInfo: any[] | null

  @column() declare diskReadMbps: number | null
  @column() declare diskWriteMbps: number | null

  // --- REDE (Mbps) - Opcional ---
  @column() declare downloadMbps: number | null
  @column() declare uploadMbps: number | null

  // --- EXTRAS ---
  @column() declare moboTemperature: number | null

  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value || []),
  })
  declare activeUsers: any[] | null

  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value || []),
  })
  declare processes: any[] | null

  // --- RELACIONAMENTO ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>
}
