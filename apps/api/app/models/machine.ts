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
import { dateTimeFromSqlUtc, dateTimeToSqlUtc } from '#utils/datetime'

const utcDateTimeColumn = {
  prepare: (value: DateTime | null) => (value ? dateTimeToSqlUtc(value) : null),
  consume: (value: string | null) => (value ? dateTimeFromSqlUtc(value) : null),
} as const

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

  /** VRAM total wire GB×10 (agente/sync-specs); conversão na serialização HTTP */
  @column()
  declare totalVramGb: number | null

  /** RAM total wire GB×10; conversão na serialização HTTP */
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

  /** IP público (NAT/port-forward) definido pelo admin; distinto do IP local do agente. */
  @column()
  declare publicIpAddress: string | null

  /** Quando true, alocações só podem usar a partição marcada como mainDisk. */
  @column({ consume: (value: unknown) => Boolean(value) })
  declare onlyMainDisk: boolean

  /** null = SSH na porta 22 */
  @column()
  declare sshPort: number | null

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
  @column.dateTime(utcDateTimeColumn)
  declare lastSeenAt: DateTime | null

  @column.dateTime(utcDateTimeColumn)
  declare tokenRotatedAt: DateTime | null

  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value || []),
  })
  declare currentSessions: any[] | null

  // Usuário do sistema operacional mapeado (para agente servidor SSH/cgroups)
  @column()
  declare systemUsername: string | null

  @column()
  declare hostFingerprint: string | null

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
    pivotColumns: ['os_username', 'provisioned_at', 'last_active_at', 'access_type'],
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
