import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'

const uniqueRule = vine.createRule(
  async (value, options: { table: string; column: string }, field) => {
    if (typeof value !== 'string') return

    const row = await db.from(options.table).select('id').where(options.column, value).first()

    if (row) {
      field.report('Este {{ field }} já está em uso.', 'unique', field)
    }
  }
)

const passwordRule = vine.string().minLength(8).maxLength(63)

export const registerValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(4).maxLength(63),
    email: vine
      .string()
      .email()
      .normalizeEmail()
      .use(uniqueRule({ table: 'users', column: 'email' })),
    password: passwordRule,
  })
)

export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().email().normalizeEmail(),
    password: passwordRule,
  })
)
