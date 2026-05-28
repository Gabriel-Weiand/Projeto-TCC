import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ssh_connection_attempts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Relacionamento com a máquina que recebeu a tentativa
      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE')
        .index()

      // Dados da conexão extraídos do Linux
      table.string('source_ip', 45).notNullable().index()
      table.string('target_username', 64).notNullable() // Ex: root, ubuntu, ou o user do aluno

      table.enum('status', ['success', 'failed', 'invalid_user']).notNullable()
      table.string('auth_method', 50).nullable() // Ex: 'publickey', 'password'

      // Assinatura da chave para rastreabilidade (se fornecida/disponível no log)
      table.string('client_fingerprint', 128).nullable()

      // Data e hora exata do evento (indexado para facilitar buscas por período)
      table.timestamp('created_at').notNullable().index()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
