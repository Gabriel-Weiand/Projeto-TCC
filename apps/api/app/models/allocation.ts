import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasOne, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasOne, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Machine from '#models/machine'
import AllocationMetric from '#models/allocation_metric'
import Telemetry from '#models/telemetry'

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

  @hasMany(() => Telemetry)
  declare telemetries: HasMany<typeof Telemetry>

  @hasOne(() => AllocationMetric)
  declare metric: HasOne<typeof AllocationMetric>
}
