import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { randomBytes } from 'node:crypto'
import Telemetry from '#models/telemetry'
import Allocation from '#models/allocation'

export default class Machine extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column({ serializeAs: null }) // Não expor token na API
  declare token: string

  @column()
  declare cpuModel: string | null

  @column()
  declare gpuModel: string | null

  @column()
  declare totalRamGb: number | null

  @column()
  declare totalDiskGb: number | null

  @column()
  declare ipAddress: string | null

  @column()
  declare macAddress: string | null

  @column()
  declare status: 'available' | 'occupied' | 'maintenance' | 'offline'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // --- RELACIONAMENTOS ---
  @hasMany(() => Telemetry)
  declare telemetries: HasMany<typeof Telemetry>

  @hasMany(() => Allocation)
  declare allocations: HasMany<typeof Allocation>

  // --- GERAÇÃO AUTOMÁTICA DA API KEY ---
  @beforeCreate()
  static assignToken(machine: Machine) {
    if (!machine.token) {
      machine.token = randomBytes(64).toString('hex')
    }
  }
}
