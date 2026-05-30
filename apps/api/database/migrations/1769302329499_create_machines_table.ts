import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'machines'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Relação 1:N -> Uma máquina pertence a um grupo
      table
        .integer('machine_group_id')
        .unsigned()
        .references('id')
        .inTable('machine_groups')
        .onDelete('SET NULL') // Se apagar o grupo, a máquina fica "órfã" (NULL), mas não é eliminada
        .index()

      table.string('name', 50).notNullable()
      table.string('description', 255).notNullable()
      table.string('system_username', 64).nullable()
      table.string('host_fingerprint', 128).nullable().index()

      // BEARER KEY DO AGENTE
      table.string('token', 128).notNullable().unique().index()

      // Especificações de Hardware
      table.string('cpu_model', 100).nullable()
      table.string('gpu_model', 100).nullable()
      table.integer('total_ram_gb').unsigned().nullable()

      // Convertido para JSONB para alta performance e portabilidade
      table.jsonb('disks').nullable()

      // Identificador de Rede
      table.string('ip_address', 45).nullable()

      // Status da máquina e configurações do agente
      table.enum('status', ['available', 'occupied', 'maintenance', 'offline']).defaultTo('offline')
      table.jsonb('custom_agent_config').nullable() // Convertido para JSONB

      // Campos de Segurança/Auditoria do Agente
      table.timestamp('last_seen_at').nullable()
      table.timestamp('token_rotated_at').nullable()

      // Convertido para JSONB
      table.jsonb('current_sessions').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
