import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'machines'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('name', 50).notNullable()
      table.string('description', 255).notNullable()

      // A API KEY DO AGENTE
      table.string('token', 128).notNullable().unique().index()

      // Especificações de Hardware
      table.string('cpu_model', 100).nullable() // Ex: "Intel Core i7-12700K"
      table.string('gpu_model', 100).nullable() // Ex: "NVIDIA GeForce RTX 3060"
      table.integer('total_ram_gb').unsigned().nullable() // Ex: 16 (GB)
      table.integer('total_disk_gb').unsigned().nullable() // Ex: 512 (GB SSD)

      // Identificadores de Rede
      table.string('ip_address', 45).nullable() // IPv4 ou IPv6
      table.string('mac_address', 17).notNullable().unique() // AA:BB:CC:DD:EE:FF - Chave de autenticação do agente

      // Status da máquina
      table.enum('status', ['available', 'occupied', 'maintenance', 'offline']).defaultTo('offline')

      // Campos de Segurança/Auditoria do Agente
      table.timestamp('last_seen_at').nullable() // Último heartbeat recebido
      table.timestamp('token_rotated_at').nullable() // Última rotação do token
      table.string('logged_user', 100).nullable() // Usuário logado no SO (reportado pelo agente)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
