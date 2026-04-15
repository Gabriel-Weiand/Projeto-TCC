import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Allocation from '#models/allocation'
import Machine from '#models/machine'
import User from '#models/user'

export default class SshSession extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare allocationId: number

  @column()
  declare machineId: number

  @column()
  declare userId: number

  @column()
  declare systemUsername: string

  @column()
  declare publicKeyFingerprint: string

  @column()
  declare status: 'active' | 'expired' | 'revoked'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime()
  declare revokedAt: DateTime | null

  // --- RELACIONAMENTOS ---
  @belongsTo(() => Allocation)
  declare allocation: BelongsTo<typeof Allocation>

  @belongsTo(() => Machine)
  declare machine: BelongsTo<typeof Machine>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
