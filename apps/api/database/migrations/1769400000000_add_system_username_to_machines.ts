import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'machines'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Usuário do sistema operacional mapeado para esta máquina (ex: "render01")
      // Usado pelo agente servidor para gerenciar SSH e cgroups
      table.string('system_username', 64).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('system_username')
    })
  }
}
