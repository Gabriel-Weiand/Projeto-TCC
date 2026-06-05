import app from '@adonisjs/core/services/app'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type LabRuntimeSettings = {
  requireAdminApproval?: boolean
  publicNames?: boolean
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

function storagePath(): string {
  return app.makePath('storage/lab/runtime_settings.json')
}

function loadStorageOverrides(): LabRuntimeSettings | null {
  const path = storagePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as LabRuntimeSettings
  } catch {
    return null
  }
}

/** Valores efetivos: env → overrides em storage (PUT admin). */
export function getLabRuntimeSettings(): {
  requireAdminApproval: boolean
  publicNames: boolean
  sources: { requireAdminApproval: 'env' | 'runtime'; publicNames: 'env' | 'runtime' }
} {
  const stored = loadStorageOverrides()
  const envApproval = envBool('LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL', false)
  const envPublicNames = envBool('LAB_ALLOCATION_PUBLIC_NAMES', false)

  return {
    requireAdminApproval:
      typeof stored?.requireAdminApproval === 'boolean'
        ? stored.requireAdminApproval
        : envApproval,
    publicNames:
      typeof stored?.publicNames === 'boolean' ? stored.publicNames : envPublicNames,
    sources: {
      requireAdminApproval:
        typeof stored?.requireAdminApproval === 'boolean' ? 'runtime' : 'env',
      publicNames: typeof stored?.publicNames === 'boolean' ? 'runtime' : 'env',
    },
  }
}

export function isRuntimePublicNamesEnabled(): boolean {
  return getLabRuntimeSettings().publicNames
}

export function isRuntimeRequireAdminApproval(): boolean {
  return getLabRuntimeSettings().requireAdminApproval
}

export function saveLabRuntimeSettings(patch: LabRuntimeSettings): LabRuntimeSettings {
  const path = storagePath()
  const current = loadStorageOverrides() ?? {}
  const next: LabRuntimeSettings = { ...current }

  if (typeof patch.requireAdminApproval === 'boolean') {
    next.requireAdminApproval = patch.requireAdminApproval
  }
  if (typeof patch.publicNames === 'boolean') {
    next.publicNames = patch.publicNames
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
