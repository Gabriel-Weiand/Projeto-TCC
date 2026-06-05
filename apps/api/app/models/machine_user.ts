import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Machine from '#models/machine'

export default class MachineUser extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare machineId: number

  @column()
  declare userId: number

  @column()
  declare osUsername: string

  @column.dateTime()
  declare provisionedAt: DateTime | null

  @column.dateTime()
  declare lastActiveAt: DateTime | null

  @column()
  declare accessType: 'auto' | 'shell' | 'sftp' | 'revoked'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Machine)
  declare machine: BelongsTo<typeof Machine>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
