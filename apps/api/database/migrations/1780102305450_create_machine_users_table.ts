import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'machine_users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // FK para a Máquina
      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE') // Se a máquina for deletada, limpa o inventário dela
        .notNullable()
        .index()

      // FK para o Usuário
      table
        .integer('user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE') // Se o aluno for deletado do sistema, remove ele das máquinas
        .notNullable()
        .index()

      // CRÍTICO: Impede que o sistema cadastre o mesmo aluno na mesma máquina duas vezes
      table.unique(['machine_id', 'user_id'])

      // Nome exato que o agente criou no Linux (ex: lab.gabriel_santos)
      table.string('os_username', 64).notNullable()

      // Timestamps de auditoria
      table.timestamp('provisioned_at').nullable() // Quando o agente confirmou a criação
      table.timestamp('last_active_at').nullable() // Quando foi a última vez que usou a máquina

      // Override admin: auto segue alocação; demais valores fixam o provisioning no heartbeat
      table
        .enum('access_type', ['auto', 'shell', 'sftp', 'revoked'])
        .notNullable()
        .defaultTo('auto')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
