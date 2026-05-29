import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'telemetries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('allocation_id')
        .unsigned()
        .references('id')
        .inTable('allocations')
        .onDelete('CASCADE')
        .index()

      table.timestamp('timestamp').notNullable().index()

      // --- CPU ---
      table.integer('cpu_usage').unsigned().notNullable()
      table.integer('cpu_temp').unsigned().notNullable()
      table.integer('cpu_freq_mhz').unsigned().nullable()

      // --- GPU ---
      table.integer('gpu_usage').unsigned().notNullable()
      table.integer('gpu_temp').unsigned().notNullable()
      table.integer('gpu_power_watts').unsigned().nullable()
      table.integer('vram_total_gb').unsigned().nullable()
      table.integer('vram_used_gb').unsigned().nullable()

      // --- RAM & SWAP ---
      table.integer('ram_total_gb').unsigned().nullable()
      table.integer('ram_used_gb').unsigned().nullable()
      table.integer('swap_total_gb').unsigned().nullable()
      table.integer('swap_used_gb').unsigned().nullable()

      // --- DISCO E I/O ---
      table.jsonb('disks_info').nullable() // Convertido para JSONB
      table.integer('disk_read_mbps').unsigned().nullable()
      table.integer('disk_write_mbps').unsigned().nullable()

      // --- REDE ---
      table.integer('download_mbps').unsigned().nullable()
      table.integer('upload_mbps').unsigned().nullable()

      table.integer('mobo_temperature').unsigned().nullable()

      // Contexto - Apenas utilizadores ativos (Convertido para JSONB)
      table.jsonb('active_users').nullable()

      // Lista imutável de processos (Convertido para JSONB)
      table.jsonb('processes').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}