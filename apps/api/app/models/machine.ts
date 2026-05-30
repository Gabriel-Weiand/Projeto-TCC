import { DateTime } from 'luxon'
import {
  BaseModel,
  column,
  beforeCreate,
  computed,
  hasMany,
  manyToMany,
  belongsTo,
} from '@adonisjs/lucid/orm'
import type { HasMany, ManyToMany, BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomBytes } from 'node:crypto'
import Allocation from '#models/allocation'
import MachineGroup from '#models/machine_group'
import User from './user.js'

export default class Machine extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare machineGroupId: number | null

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
  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value || []),
  })
  declare disks: any[] | null

  @column()
  declare ipAddress: string | null

  @column()
  declare status: 'available' | 'occupied' | 'maintenance' | 'offline'

  @column()
  declare telemetryPreset: 'fast' | 'eco' | 'custom'

  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value || null),
  })
  declare customAgentConfig: any | null

  // Campos de Segurança/Auditoria do Agente
  @column.dateTime()
  declare lastSeenAt: DateTime | null

  @column.dateTime()
  declare tokenRotatedAt: DateTime | null

  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value || []),
  })
  declare currentSessions: any[] | null

  // Usuário do sistema operacional mapeado (para agente servidor SSH/cgroups)
  @column()
  declare systemUsername: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // --- RELACIONAMENTOS ---
  @belongsTo(() => MachineGroup)
  declare group: BelongsTo<typeof MachineGroup>

  @hasMany(() => Allocation)
  declare allocations: HasMany<typeof Allocation>

  @manyToMany(() => User, {
    pivotTable: 'machine_users',
    pivotTimestamps: true,
    pivotColumns: ['os_username', 'provisioned_at', 'last_active_at'],
  })
  declare provisionedUsers: ManyToMany<typeof User>

  /** Computed: soma dos `totalGb` das partições (ou null se não houver dados) */
  @computed()
  public get totalDiskGb(): number | null {
    const arr = this.disks as Array<any>
    if (!arr || arr.length === 0) return null
    const sum = arr.reduce((acc, d) => acc + Number(d?.totalGb ?? 0), 0)
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
