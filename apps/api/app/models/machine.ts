import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, computed, hasMany } from '@adonisjs/lucid/orm'
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

  // JSON stored as text in DB (column name: 'disks').
  @column({ columnName: 'disks' })
  declare disksJson: string | null

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

  // Usuário do sistema operacional mapeado (para agente servidor SSH/cgroups)
  @column()
  declare systemUsername: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // --- RELACIONAMENTOS ---
  @hasMany(() => Allocation)
  declare allocations: HasMany<typeof Allocation>

  /** Computed: retorna os discos como array (parse do JSON em `disksJson`) */
  @computed()
  public get disks() {
    try {
      const parsed = JSON.parse(this.disksJson ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /** Computed: soma dos `totalGb` das partições (ou null se não houver dados) */
  @computed()
  public get totalDiskGb(): number | null {
    const arr = this.disks as Array<any>
    if (!arr || arr.length === 0) return null
    const sum = arr.reduce((acc, d) => acc + (Number(d?.totalGb ?? 0)), 0)
    return Math.round(sum * 10) / 10
  }

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
