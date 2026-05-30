import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, hasMany, manyToMany, beforeCreate } from '@adonisjs/lucid/orm'
import type { HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import db from '@adonisjs/lucid/services/db'
import Allocation from '#models/allocation'
import Machine from '#models/machine'
import Notification from '#models/notification'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare fullName: string

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string

  @column()
  declare role: 'user' | 'admin'

  @column()
  declare systemUsername: string | null

  @column()
  declare sshPublicKey: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // --- RELACIONAMENTOS ---
  @hasMany(() => Allocation)
  declare allocations: HasMany<typeof Allocation>

  @hasMany(() => Notification)
  declare notifications: HasMany<typeof Notification>

  // O Decorator agora aponta diretamente para a variável correta
  @manyToMany(() => Machine, {
    pivotTable: 'machine_users',
    pivotTimestamps: true,
    pivotColumns: ['os_username', 'provisioned_at', 'last_active_at'],
  })
  declare provisionedMachines: ManyToMany<typeof Machine>

  // O provedor de tokens fica isolado no final
  static accessTokens = DbAccessTokensProvider.forModel(User, {
    expiresIn: '6 hours',
  })

  // --- HOOKS ---

  /**
   * Executado automaticamente antes de salvar um novo usuário no banco.
   * Gera o system_username baseado no fullName, prefixado com 'lab.'
   */
  @beforeCreate()
  static async generateSystemUsername(user: User) {
    if (user.systemUsername) return // Pula se já houver um definido (útil para seeders)

    // 1. Limpeza: NFD separa letras de acentos.
    const cleanName = user.fullName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove os acentos
      .toLowerCase()
      .replace(/\s+/g, '_') // Substitui espaços por underline
      .replace(/[^a-z0-9_]/g, '') // Remove qualquer outro símbolo especial
      .substring(0, 50) // Limita a 50 caracteres para não estourar os 64 do banco

    const prefix = 'lab.'
    const proposedName = `${prefix}${cleanName}`

    // 2. Resolução de Conflitos (Garantir Unicidade)
    let isUnique = false
    let counter = 1
    let finalName = proposedName

    while (!isUnique) {
      // Checa se já existe alguém com esse system_username no banco
      const existingUser = await db
        .from('users')
        .select('id')
        .where('system_username', finalName)
        .first()

      if (!existingUser) {
        // Nome está livre!
        isUnique = true
      } else {
        // Nome em uso, adiciona o número e tenta de novo no while
        finalName = `${proposedName}${counter}`
        counter++
      }
    }

    // 3. Atribui o nome final validado
    user.systemUsername = finalName
  }
}
