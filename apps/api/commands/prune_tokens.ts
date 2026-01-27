import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export default class PruneTokens extends BaseCommand {
  static commandName = 'prune:tokens'
  static description = 'Remove expired access tokens from the database'

  static options: CommandOptions = {
    startApp: true, // Precisa do app para acessar o banco
  }

  async run() {
    const now = DateTime.now().toSQL()

    const result = await db
      .from('auth_access_tokens')
      .where('expires_at', '<', now)
      .delete()

    if (result[0] > 0) {
      this.logger.success(`Deleted ${result[0]} expired token(s)`)
    } else {
      this.logger.info('No expired tokens found')
    }
  }
}
