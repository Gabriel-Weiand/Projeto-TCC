import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { pruneExpiredTokens } from '#services/lab/maintenance'

export default class PruneTokens extends BaseCommand {
  static commandName = 'prune:tokens'
  static description = 'Remove expired access tokens from the database'

  static options: CommandOptions = {
    startApp: true, // Precisa do app para acessar o banco
  }

  async run() {
    const deleted = await pruneExpiredTokens()

    if (deleted > 0) {
      this.logger.success(`Deleted ${deleted} expired token(s)`)
    } else {
      this.logger.info('No expired tokens found')
    }
  }
}
