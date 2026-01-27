import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'

/**
 * Regra customizada para verificar unicidade no banco.
 * Suporta metadata para ignorar o próprio registro no update.
 */
const uniqueRule = vine.createRule(
  async (value, options: { table: string; column: string }, field) => {
    if (typeof value !== 'string') return

    let query = db.from(options.table).select('id').where(options.column, value)

    // Ignora o próprio registro no update (via metadata)
    const exceptId = field.meta?.userId
    if (exceptId) {
      query = query.whereNot('id', exceptId)
    }

    const row = await query.first()

    if (row) {
      field.report('Este {{ field }} já está em uso.', 'unique', field)
    }
  }
)

/**
 * Validator para atualização de usuário.
 * Usa metadata para passar o userId atual e ignorar na validação de unicidade.
 * 
 * Uso: await request.validateUsing(updateUserValidator, { meta: { userId: params.id } })
 */
export const updateUserValidator = vine.withMetaData<{ userId: number }>().compile(
  vine.object({
    fullName: vine.string().trim().minLength(4).maxLength(63).optional(),
    email: vine
      .string()
      .email()
      .normalizeEmail()
      .use(uniqueRule({ table: 'users', column: 'email' }))
      .optional(),
    password: vine.string().minLength(8).maxLength(63).optional(),
    role: vine.enum(['user', 'admin'] as const).optional(),
  })
)
