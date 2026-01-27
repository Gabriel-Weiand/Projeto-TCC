import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'

export default class extends BaseSeeder {
  private async seed(Seeder: { default: typeof BaseSeeder }) {
    await new Seeder.default(this.client).run()
  }

  async run() {
    // Executa seeders na ordem correta (respeitando foreign keys)
    await this.seed(await import('#database/seeders/user_seeder'))
    await this.seed(await import('#database/seeders/machine_seeder'))
    await this.seed(await import('#database/seeders/allocation_seeder'))

    console.log('\n✅ Database seeded successfully!')
    console.log('\n📋 Credenciais para teste:')
    console.log('=' .repeat(50))
    console.log('ADMIN:   admin@lab.ufpel.edu.br / admin123')
    console.log('ALUNO:   gabriel.santos@ufpel.edu.br / aluno123')
    console.log('=' .repeat(50) + '\n')
  }
}
