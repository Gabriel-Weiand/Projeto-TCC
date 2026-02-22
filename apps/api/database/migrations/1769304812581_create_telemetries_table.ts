import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'telemetries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Telemetria pertence a uma alocação (contém user + machine)
      table
        .integer('allocation_id')
        .unsigned()
        .references('id')
        .inTable('allocations')
        .onDelete('CASCADE')
        .index()

      // --- DADOS DE HARDWARE (Escala 0 a 1000) ---
      // 0 = 0.0%, 1000 = 100.0% | 650 = 65.0ºC

      table.integer('cpu_usage').unsigned().notNullable()
      table.integer('cpu_temp').unsigned().notNullable()

      table.integer('gpu_usage').unsigned().notNullable()
      table.integer('gpu_temp').unsigned().notNullable()

      table.integer('ram_usage').unsigned().notNullable()
      table.integer('disk_usage').unsigned().nullable() // % de uso do disco ativo (opcional)

      // --- REDE (Mbps) ---
      table.integer('download_usage').unsigned().nullable() // Opcional: nem sempre disponível
      table.integer('upload_usage').unsigned().nullable() // Opcional: nem sempre disponível

      table.integer('mobo_temperature').unsigned().nullable()

      // Contexto - Essencial para auditoria
      table.string('logged_user_name').notNullable()

      // Sem created_at: o ID auto-increment serve como sequência temporal (1 telemetria/segundo)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
