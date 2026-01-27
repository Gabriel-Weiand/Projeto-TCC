import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class extends BaseSeeder {
  async run() {
    await User.createMany([
      // Admin principal
      {
        fullName: 'Administrador',
        email: 'admin@lab.ufpel.edu.br',
        password: 'admin123',
        role: 'admin',
      },
      // Admin secundário (para testes)
      {
        fullName: 'Professor Silva',
        email: 'silva@lab.ufpel.edu.br',
        password: 'prof1234',
        role: 'admin',
      },
      // Usuários normais (alunos)
      {
        fullName: 'Gabriel Santos',
        email: 'gabriel.santos@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Maria Oliveira',
        email: 'maria.oliveira@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'João Pereira',
        email: 'joao.pereira@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Ana Costa',
        email: 'ana.costa@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
    ])
  }
}