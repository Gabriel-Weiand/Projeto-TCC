import User from '#models/user'

export function buildAdminUserPayload() {
  return {
    fullName: process.env.LAB_SEED_ADMIN_NAME?.trim() || 'Administrador Principal',
    email: process.env.LAB_SEED_ADMIN_EMAIL?.trim() || 'admin@lab.ufpel.edu.br',
    password: process.env.LAB_SEED_ADMIN_PASSWORD?.trim() || 'admin123',
    role: 'admin' as const,
    sshPublicKey:
      process.env.LAB_SEED_ADMIN_SSH_KEY?.trim() ||
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPfakeAdminKey... admin@local',
  }
}

export async function seedAdminUser() {
  const payload = buildAdminUserPayload()
  const existing = await User.findBy('email', payload.email)
  if (existing) {
    console.log(`\n--- Admin existente ---`)
    console.log(`  ${existing.email}`)
    console.log('---\n')
    return existing
  }

  const admin = await User.create(payload)
  console.log(`\n--- Admin inicial ---`)
  console.log(`  ${admin.email} / ${payload.password}`)
  console.log('---\n')
  return admin
}
