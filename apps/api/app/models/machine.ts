import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { randomBytes } from 'node:crypto'
import Allocation from '#models/allocation'

export default class Machine extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare description: string

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
  declare macAddress: string

  @column()
  declare status: 'available' | 'occupied' | 'maintenance' | 'offline'

  // Campos de Segurança/Auditoria do Agente
  @column.dateTime()
  declare lastSeenAt: DateTime | null

  @column.dateTime()
  declare tokenRotatedAt: DateTime | null

  @column()
  declare loggedUser: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // --- RELACIONAMENTOS ---
  @hasMany(() => Allocation)
  declare allocations: HasMany<typeof Allocation>

  // --- GERAÇÃO AUTOMÁTICA DA API KEY ---
  @beforeCreate()
  static assignToken(machine: Machine) {
    if (!machine.token) {
      machine.token = randomBytes(64).toString('hex')
    }
  }

  /**
   * Regenera o token da máquina (para rotação de segurança)
   */
  regenerateToken(): string {
    this.token = randomBytes(64).toString('hex')
    this.tokenRotatedAt = DateTime.now()
    return this.token
  }
}
