import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class extends BaseSeeder {
  async run() {
    const users = [
      {
        fullName: 'Administrador Principal',
        email: 'admin@lab.ufpel.edu.br',
        password: 'admin123',
        role: 'admin' as const,
        sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPfakeAdminKey... admin@local',
      },
      {
        fullName: 'Professor Silva',
        email: 'silva@lab.ufpel.edu.br',
        password: 'prof1234',
        role: 'admin' as const,
      },
      {
        fullName: 'Gabriel Santos',
        email: 'gabriel.santos@ufpel.edu.br',
        password: 'aluno123',
        role: 'user' as const,
        sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBFRuyv6OZIWKCPKRomv9dUcoAMdVA5cSnJShykFAEWZ teste_pc_ssh',
      },
      {
        fullName: 'Maria Oliveira',
        email: 'maria.oliveira@ufpel.edu.br',
        password: 'aluno123',
        role: 'user' as const,
        sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPfakeUserKey2... maria@local',
      },
      {
        fullName: 'João Pereira',
        email: 'joao.pereira@ufpel.edu.br',
        password: 'aluno123',
        role: 'user' as const,
      },
      {
        fullName: 'Ana Costa',
        email: 'ana.costa@ufpel.edu.br',
        password: 'aluno123',
        role: 'user' as const,
      },
      {
        fullName: 'Carlos Mendes',
        email: 'carlos.mendes@ufpel.edu.br',
        password: 'aluno123',
        role: 'user' as const,
      },
      {
        fullName: 'Fernanda Lima',
        email: 'fernanda.lima@ufpel.edu.br',
        password: 'aluno123',
        role: 'user' as const,
      },
    ]

    for (const data of users) {
      await User.create(data)
    }
  }
}
