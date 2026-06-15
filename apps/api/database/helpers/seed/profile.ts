export type SeedProfile = 'dev' | 'minimal' | 'lab'

const VALID_PROFILES: SeedProfile[] = ['dev', 'minimal', 'lab']

export function resolveSeedProfile(): SeedProfile {
  const raw = process.env.LAB_SEED_PROFILE?.trim().toLowerCase()
  if (raw && VALID_PROFILES.includes(raw as SeedProfile)) {
    return raw as SeedProfile
  }
  return 'dev'
}

export function isSeedProfile(value: string): value is SeedProfile {
  return VALID_PROFILES.includes(value as SeedProfile)
}
