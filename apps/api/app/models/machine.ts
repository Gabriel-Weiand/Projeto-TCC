import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate } from '@adonisjs/lucid/orm'
import { randomBytes } from 'node:crypto'

export default class Machine extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column()
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

  // --- GERAÇÃO AUTOMÁTICA DA API KEY ---
  @beforeCreate()
  static assignToken(machine: Machine) {
    if (!machine.token) {
      // 64 bytes convertidos para Hexadecimal geram exatamente 128 caracteres
      machine.token = randomBytes(64).toString('hex')
    }
  }
}
