import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ssh_sessions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('allocation_id')
        .unsigned()
        .references('id')
        .inTable('allocations')
        .onDelete('CASCADE')
        .notNullable()

      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE')
        .notNullable()

      table
        .integer('user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .notNullable()

      // Usuário do sistema para o qual a chave SSH foi provisionada
      table.string('system_username', 64).notNullable()

      // Fingerprint da chave pública (para remoção posterior do authorized_keys)
      table.string('public_key_fingerprint', 128).notNullable()

      // Status da sessão SSH
      table
        .enum('status', ['active', 'expired', 'revoked'])
        .defaultTo('active')
        .notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('revoked_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
