import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'allocations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Relacionamentos (Foreign Keys)
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE')

      // Dados da Reserva
      table.timestamp('start_time').notNullable()
      table.timestamp('end_time').notNullable() // Ou duration, mas timestamp facilita query "BETWEEN"

      table.string('reason', 255).nullable() // Motivo da Reserva

      // Status
      // pending: Solicitado (se implementarmos aprovação manual)
      // approved: Válido, pode logar
      // denied: Recusado pelo admin
      // cancelled: Cancelado pelo aluno
      // finished: Já ocorreu
      table
        .enum('status', ['pending', 'approved', 'denied', 'cancelled', 'finished'])
        .defaultTo('approved') // No seu MVP é aprovação automática

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
