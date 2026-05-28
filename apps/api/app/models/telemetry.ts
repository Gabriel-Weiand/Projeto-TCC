import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon' // <-- Adicionar no topo (junto com os outros imports)
import Allocation from '#models/allocation'

export default class Telemetry extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare allocationId: number

  @column()
  declare timestamp: string

  // --- HARDWARE (Escala 0-1000) ---
  @column() declare cpuUsage: number
  @column() declare cpuTemp: number
  @column() declare cpuFreqMhz: number | null // MHz inteiro, opcional
  @column() declare gpuUsage: number
  @column() declare gpuTemp: number
  @column() declare gpuPowerWatts: number | null
  @column() declare vramTotalMb: number | null
  @column() declare vramUsedMb: number | null

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
    consume: (value: string) => JSON.parse(value),
  })
  declare activeUsers: any[] | null

  // --- RELACIONAMENTO ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>
}
