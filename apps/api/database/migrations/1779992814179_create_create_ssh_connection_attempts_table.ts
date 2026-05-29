import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ssh_connection_attempts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE')
        .index()

      table.string('source_ip', 45).notNullable().index()
      table.string('target_username', 64).notNullable()
      table.enum('status', ['success', 'failed', 'invalid_user']).notNullable()
      table.string('auth_method', 50).nullable()
      table.string('client_fingerprint', 128).nullable()

      table.timestamp('created_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}