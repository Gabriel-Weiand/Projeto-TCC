import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class extends BaseSeeder {
  static environment = ['via_index']

  async run() {
    await User.createMany([
      // ---- Admins (userId 1–2) ----
      {
        fullName: 'Administrador',
        email: 'admin@lab.ufpel.edu.br',
        password: 'admin123',
        role: 'admin',
      },
      {
        fullName: 'Professor Silva',
        email: 'silva@lab.ufpel.edu.br',
        password: 'prof1234',
        role: 'admin',
      },
      // ---- Alunos (userId 3–15) ----
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
      {
        fullName: 'Carlos Mendes',
        email: 'carlos.mendes@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Fernanda Lima',
        email: 'fernanda.lima@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Rafael Torres',
        email: 'rafael.torres@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Beatriz Alves',
        email: 'beatriz.alves@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Lucas Rodrigues',
        email: 'lucas.rodrigues@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Camila Ferreira',
        email: 'camila.ferreira@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Pedro Nascimento',
        email: 'pedro.nascimento@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Juliana Moura',
        email: 'juliana.moura@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
      {
        fullName: 'Thiago Barbosa',
        email: 'thiago.barbosa@ufpel.edu.br',
        password: 'aluno123',
        role: 'user',
      },
    ])
  }
}
