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
      table.float('avg_cpu_usage')
      table.float('max_cpu_usage')
      table.float('avg_cpu_temp')
      table.float('max_cpu_temp') // Crítico para alertas térmicos

      // --- PLACA DE VÍDEO (GPU) ---
      table.float('avg_gpu_usage')
      table.float('max_gpu_usage')
      table.float('avg_gpu_temp')
      table.float('max_gpu_temp')

      // --- MEMÓRIA (RAM) ---
      table.float('avg_ram_usage')
      table.float('max_ram_usage')

      // --- DISCO ---
      table.float('avg_disk_usage')
      table.float('max_disk_usage')

      // --- REDE (Download/Upload) ---
      table.float('avg_download_usage') // Mbps
      table.float('max_download_usage')
      table.float('avg_upload_usage')
      table.float('max_upload_usage')

      // --- PLACA MÃE ---
      table.float('avg_mobo_temp')
      table.float('max_mobo_temp')

      // --- OUTROS ---
      table.integer('session_duration_minutes').unsigned() // Duração total

      table.timestamp('created_at') // Data da consolidação
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
