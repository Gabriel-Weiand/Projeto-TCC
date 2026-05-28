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

      table.timestamp('timestamp').notNullable().index()

      // --- DADOS DE HARDWARE (Escala 0 a 1000) ---
      // 0 = 0.0%, 1000 = 100.0% | 650 = 65.0ºC

      // --- CPU ---
      table.integer('cpu_usage').unsigned().notNullable()
      table.integer('cpu_temp').unsigned().notNullable()
      table.integer('cpu_freq_mhz').unsigned().nullable() // Frequência média (MHz)

      // --- GPU ---
      table.integer('gpu_usage').unsigned().notNullable()
      table.integer('gpu_temp').unsigned().notNullable()
      table.integer('gpu_power_watts').unsigned().nullable()
      table.integer('vram_total_gb').unsigned().nullable()
      table.integer('vram_used_gb').unsigned().nullable()

      // --- RAM & SWAP (Escala Absoluta x10) ---
      // Ex.: 165 = 16.5 GB. Usamos integer para otimizar espaço como nos dados anteriores.
      table.integer('ram_total_gb').unsigned().nullable()
      table.integer('ram_used_gb').unsigned().nullable()

      table.integer('swap_total_gb').unsigned().nullable()
      table.integer('swap_used_gb').unsigned().nullable()

      // --- DISCO E I/O (Mbps)---
      table.text('disks_info').nullable()
      table.integer('disk_read_mbps').unsigned().nullable()
      table.integer('disk_write_mbps').unsigned().nullable()

      // --- REDE (Mbps) ---
      table.integer('download_mbps').unsigned().nullable()
      table.integer('upload_mbps').unsigned().nullable()

      table.integer('mobo_temperature').unsigned().nullable()

      // Contexto - Apenas usuários ativos
      table.text('active_users').nullable()

      // JSON com as informações dos processos rodando no momento da coleta
      table.text('processes').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
