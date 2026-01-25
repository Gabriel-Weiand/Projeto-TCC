import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'telemetries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Indexamos machine_id pois sempre buscaremos dados "DE UMA" máquina
      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE')
        .index()

      // Opcional: Se você quiser ligar esse dado bruto a uma alocação específica já na coleta
      // table.integer('allocation_id').unsigned().references('id').inTable('allocations').onDelete('SET NULL')

      // --- DADOS DE HARDWARE (Escala 0 a 1000) ---
      // 0 = 0.0%, 1000 = 100.0% | 650 = 65.0ºC

      table.integer('cpu_usage').unsigned().notNullable()
      table.integer('cpu_temp').unsigned().notNullable()

      table.integer('gpu_usage').unsigned().notNullable()
      table.integer('gpu_temp').unsigned().notNullable()

      table.integer('ram_usage').unsigned().notNullable()
      table.integer('disk_usage').unsigned().notNullable() // % de uso do disco ativo

      // --- REDE (Mbps) ---
      // Sugestão: Use integer normal (kbps) ou apenas Mbps sem casa decimal se não precisar de precisão fina.
      table.integer('download_usage').unsigned().notNullable()
      table.integer('upload_usage').unsigned().notNullable()

      table.integer('mobo_temperature').unsigned().nullable()

      // Contexto
      table.string('logged_user_name').nullable()

      // Data da Coleta (Indexado para gráficos e limpeza)
      table.timestamp('created_at').index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
