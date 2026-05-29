import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      
      // Chave estrangeira ligando ao usuário
      table
        .integer('user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .index()
        
      table.string('title', 120).notNullable()
      table.text('message').notNullable()
      
      // Controle de leitura super rápido para queries
      table.boolean('is_read').notNullable().defaultTo(false)
      table.timestamp('read_at').nullable()
      
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}