import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'machines'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('name', 50).notNullable()
      table.string('description', 255).notNullable()
      table.string('system_username', 64).nullable()

      // BEARER KEY DO AGENTE
      table.string('token', 128).notNullable().unique().index()

      // Especificações de Hardware
      table.string('cpu_model', 100).nullable()
      table.string('gpu_model', 100).nullable()
      table.integer('total_ram_gb').unsigned().nullable()
      // Armazena um JSON com as partições/discos relevantes (ex: partição '/').
      // Usamos texto para compatibilidade com SQLite (JSON armazenado como string).
      table.text('disks').nullable()

      // Identificador de Rede
      table.string('ip_address', 45).nullable()

      // Status da máquina e configurações do agente
      table.enum('status', ['available', 'occupied', 'maintenance', 'offline']).defaultTo('offline')
      table.text('custom_agent_config').nullable()

      // Campos de Segurança/Auditoria do Agente
      table.timestamp('last_seen_at').nullable()
      table.timestamp('token_rotated_at').nullable()

      // Atualizado via Telemetria (não via sync_specs)
      table.text('active_users').nullable()

      // JSON para armazenar o array de tentativas de conexão SSH
      table.text('ssh_connection_attempts').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })

    this.schema.createTable('machine_groups', (table) => {
      table.increments('id')
      table.string('name', 80).notNullable().unique()
      table.string('description', 255).nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('machine_group_machines', (table) => {
      table.increments('id')
      table
        .integer('machine_group_id')
        .unsigned()
        .references('id')
        .inTable('machine_groups')
        .onDelete('CASCADE')
        .index()
      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE')
        .index()
      table.unique(['machine_group_id', 'machine_id'])
    })

    this.schema.createTable('ssh_connection_attempts', (table) => {
      table.increments('id')
      table
        .integer('machine_id')
        .unsigned()
        .references('id')
        .inTable('machines')
        .onDelete('CASCADE')
        .index()
      table.string('source_ip', 45).notNullable()
      table.string('client_fingerprint', 128).notNullable()
      table.enum('status', ['success', 'failure']).notNullable()
      table.timestamp('created_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable('ssh_connection_attempts')
    this.schema.dropTable('machine_group_machines')
    this.schema.dropTable('machine_groups')
    this.schema.dropTable(this.tableName)
  }
}
