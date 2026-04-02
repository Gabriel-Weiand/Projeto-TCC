import { BaseSeeder } from '@adonisjs/lucid/seeders'

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
    console.log('='.repeat(50))
    console.log('ADMIN:   admin@lab.ufpel.edu.br / admin123')
    console.log('PROF:    silva@lab.ufpel.edu.br  / prof1234')
    console.log('ALUNO 1: gabriel.santos@ufpel.edu.br / aluno123')
    console.log('ALUNO 2: maria.oliveira@ufpel.edu.br / aluno123')
    console.log('ALUNO 3: joao.pereira@ufpel.edu.br   / aluno123')
    console.log('ALUNO 4: ana.costa@ufpel.edu.br      / aluno123')
    console.log('='.repeat(50))
    console.log('\n🧪 Cenários de teste:')
    console.log('  - Login como ALUNO e ver calendário com alocações de várias máquinas')
    console.log('  - Clicar em reservas finalizadas para ver estatísticas de uso')
    console.log('  - Login como ADMIN e aprovar/negar reservas pendentes')
    console.log('  - Acessar detalhe de uma máquina e ver agenda semanal')
    console.log('')
  }
}
