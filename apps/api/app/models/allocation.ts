import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Machine from '#models/machine'

export default class Allocation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare machineId: number

  @column.dateTime()
  declare startTime: DateTime

  @column.dateTime()
  declare endTime: DateTime

  @column()
  declare reason: string | null

  @column()
  declare status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'finished'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // --- RELACIONAMENTOS ---

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Machine)
  declare machine: BelongsTo<typeof Machine>
}
