import { args, BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { isSeedProfile } from '../database/helpers/seed/profile.js'

export default class SeedFresh extends BaseCommand {
  static commandName = 'seed:fresh'
  static description =
    'Recria o banco (migration:fresh) e aplica um perfil de seed: dev, minimal ou lab'

  static options: CommandOptions = {
    startApp: false,
  }

  @args.string({
    description: 'Perfil: dev (fictício completo) | minimal (só admin) | lab (parque real)',
    default: 'dev',
  })
  declare profile: string

  async run() {
    const profile = this.profile.trim().toLowerCase()

    if (!isSeedProfile(profile)) {
      this.logger.error(`Perfil inválido "${this.profile}". Use: dev, minimal ou lab.`)
      this.exitCode = 1
      return
    }

    process.env.LAB_SEED_PROFILE = profile
    this.logger.info(`Aplicando perfil de seed: ${profile}`)

    const fresh = await this.kernel.exec('migration:fresh', [])
    if (fresh.error) {
      this.logger.error(fresh.error.message)
      this.exitCode = 1
      return
    }

    const seed = await this.kernel.exec('db:seed', [])
    if (seed.error) {
      this.logger.error(seed.error.message)
      this.exitCode = 1
      return
    }

    this.logger.success(`Banco recriado com perfil "${profile}".`)
  }
}
