import User from '#models/user'

export async function seedDevUsers() {
  const users = [
    {
      fullName: 'Professor Teste',
      email: 'admin.professor@lab.ufpel',
      password: 'admin123',
      role: 'admin' as const,
    },
    {
      fullName: 'Gabriel Santos',
      email: 'gabriel.santos@ufpel.edu.br',
      password: 'aluno123',
      role: 'user' as const,
      sshPublicKey:
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBFRuyv6OZIWKCPKRomv9dUcoAMdVA5cSnJShykFAEWZ teste_pc_ssh',
    },
    {
      fullName: 'Usuário 2',
      email: 'usuario.2@ufpel.edu.br',
      password: 'aluno123',
      role: 'user' as const,
      sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPfakeUserKey2... aluno2@local.email',
    },
    {
      fullName: 'Usuário 1',
      email: 'user1@lab.ufpel.edu.br',
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
  ]

  for (const data of users) {
    await User.create(data)
  }
}
