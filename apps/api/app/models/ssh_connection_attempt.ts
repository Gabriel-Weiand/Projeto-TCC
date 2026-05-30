import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Machine from '#models/machine'

export default class SshConnectionAttempt extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare machineId: number

  @column()
  declare sourceIp: string

  @column()
  declare targetUsername: string

  @column()
  declare status: 'success' | 'failed' | 'invalid_user'

  @column()
  declare authMethod: string | null

  @column()
  declare clientFingerprint: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Machine)
  declare machine: BelongsTo<typeof Machine>
}
