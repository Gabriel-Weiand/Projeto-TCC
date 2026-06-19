import { args, BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { isSeedProfile } from '../database/helpers/seed/profile.js'

export default class SeedFresh extends BaseCommand {
  static commandName = 'seed:fresh'
  static description =
    'Recria o banco (migration:fresh --seed) com perfil dev, minimal ou lab'

  static options: CommandOptions = {
    startApp: false,
  }

  @args.string({
    description:
      'Perfil: dev (parque completo + Notebook-server) | lab (igual ao dev, sem Notebook-server) | minimal (só admin)',
    default: 'dev',
  })
  declare profile: string

  async run() {
    const profile = this.profile.trim().toLowerCase()

    if (!isSeedProfile(profile)) {
      this.logger.error(`Perfil inválido "${this.profile}". Use: dev, minimal ou lab.`)
      this.logger.info('Exemplos: node ace seed:fresh dev | npm run seed:lab')
      this.exitCode = 1
      return
    }

    process.env.LAB_SEED_PROFILE = profile
    this.logger.info(`Aplicando perfil de seed: ${profile}`)

    const result = await this.kernel.exec('migration:fresh', ['--seed'])
    if (result.error) {
      this.logger.error(result.error.message)
      this.exitCode = 1
      return
    }
    if (result.exitCode !== 0) {
      this.exitCode = result.exitCode
      return
    }

    this.logger.success(`Banco recriado com perfil "${profile}".`)
  }
}
