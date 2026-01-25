import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'allocation_metrics'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Chave estrangeira ligada à Alocação (1 para 1)
      table
        .integer('allocation_id')
        .unsigned()
        .references('id')
        .inTable('allocations')
        .onDelete('CASCADE')
        .unique()

      // --- PROCESSADOR (CPU) ---
      table.integer('avg_cpu_usage').unsigned()
      table.integer('max_cpu_usage').unsigned()
      table.integer('avg_cpu_temp').unsigned()
      table.integer('max_cpu_temp').unsigned() // Crítico para alertas térmicos

      // --- PLACA DE VÍDEO (GPU) ---
      table.integer('avg_gpu_usage').unsigned()
      table.integer('max_gpu_usage').unsigned()
      table.integer('avg_gpu_temp').unsigned()
      table.integer('max_gpu_temp').unsigned()

      // --- MEMÓRIA (RAM) ---
      table.integer('avg_ram_usage').unsigned()
      table.integer('max_ram_usage').unsigned()

      // --- DISCO ---
      table.integer('avg_disk_usage').unsigned()
      table.integer('max_disk_usage').unsigned()

      // --- REDE (Download/Upload) ---
      table.integer('avg_download_usage').unsigned() // Mbps
      table.integer('max_download_usage').unsigned()
      table.integer('avg_upload_usage').unsigned()
      table.integer('max_upload_usage').unsigned()

      // --- PLACA MÃE ---
      table.integer('avg_mobo_temp').unsigned()
      table.integer('max_mobo_temp').unsigned()

      // --- OUTROS ---
      table.integer('session_duration_minutes').unsigned() // Duração total

      table.timestamp('created_at') // Data da consolidação
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
