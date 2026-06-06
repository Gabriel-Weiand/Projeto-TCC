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
      table.float('avg_gpu_power_watts').nullable()
      table.float('max_gpu_power_watts').nullable()
      table.float('avg_vram_total_gb').nullable()
      table.float('max_vram_total_gb').nullable()
      table.float('avg_vram_used_gb').nullable()
      table.float('max_vram_used_gb').nullable()

      // --- MEMÓRIA (RAM e SWAP) ---
      table.float('avg_ram_used_gb').nullable()
      table.float('max_ram_used_gb').nullable()
      table.float('avg_swap_used_gb').nullable()
      table.float('max_swap_used_gb').nullable()

      // --- DISCO (nullable: nem sempre disponível) ---
      table.float('avg_disk_read_mbps').nullable()
      table.float('max_disk_read_mbps').nullable()
      table.float('avg_disk_write_mbps').nullable()
      table.float('max_disk_write_mbps').nullable()

      // --- REDE (nullable: nem sempre disponível) ---
      table.float('avg_download_mbps').nullable()
      table.float('max_download_mbps').nullable()
      table.float('avg_upload_mbps').nullable()
      table.float('max_upload_mbps').nullable()

      // --- PLACA MÃE (nullable: nem sempre disponível) ---
      table.float('avg_mobo_temp').nullable()
      table.float('max_mobo_temp').nullable()

      // --- OUTROS ---
      table.integer('session_duration_minutes').unsigned() // Duração total
      table.integer('chart_bucket_minutes').unsigned().notNullable().defaultTo(10)
      table.jsonb('chart_series').nullable() // Série resumida (wire format ×10)
      table.timestamp('created_at') // Data da consolidação
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
