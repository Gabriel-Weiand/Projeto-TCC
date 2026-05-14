import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'machines'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('name', 50).notNullable()
      table.string('description', 255).notNullable()

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

      // Status da máquina
      table.enum('status', ['available', 'occupied', 'maintenance', 'offline']).defaultTo('offline')

      // Campos de Segurança/Auditoria do Agente
      table.timestamp('last_seen_at').nullable()
      table.timestamp('token_rotated_at').nullable()

      // Atualizado via Telemetria (não via sync_specs)
      table.string('logged_user', 100).nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
