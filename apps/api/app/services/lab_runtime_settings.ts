import app from '@adonisjs/core/services/app'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** auto = segue `.env`; true/false = fixo até voltar para auto */
export type PolicyMode = 'auto' | 'true' | 'false'

export type LabRuntimeSettingsStorage = {
  requireAdminApproval?: PolicyMode
  publicNames?: PolicyMode
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

function storagePath(): string {
  return app.makePath('storage/lab/runtime_settings.json')
}

function normalizePolicyMode(raw: unknown): PolicyMode {
  if (raw === 'auto' || raw === 'true' || raw === 'false') return raw
  if (raw === true) return 'true'
  if (raw === false) return 'false'
  return 'auto'
}

function loadStorageOverrides(): LabRuntimeSettingsStorage | null {
  const path = storagePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    return {
      requireAdminApproval: normalizePolicyMode(parsed.requireAdminApproval),
      publicNames: normalizePolicyMode(parsed.publicNames),
    }
  } catch {
    return null
  }
}

function resolveEffective(mode: PolicyMode, envValue: boolean): boolean {
  if (mode === 'true') return true
  if (mode === 'false') return false
  return envValue
}

export type LabRuntimeSettingsResponse = {
  requireAdminApproval: PolicyMode
  publicNames: PolicyMode
  /** Valores definidos no `.env` (referência quando o modo é `auto`). */
  env: {
    requireAdminApproval: boolean
    publicNames: boolean
  }
}

/** Resposta pública de GET/PUT /lab/settings (modos persistidos + defaults do env). */
export function getLabRuntimeSettingsResponse(): LabRuntimeSettingsResponse {
  const { requireAdminApproval, publicNames, env } = getLabRuntimeSettings()
  return { requireAdminApproval, publicNames, env }
}

/** Valores de política: modo persistido, default do env e valor efetivo (uso interno). */
export function getLabRuntimeSettings(): LabRuntimeSettingsResponse & {
  env: { requireAdminApproval: boolean; publicNames: boolean }
  effective: { requireAdminApproval: boolean; publicNames: boolean }
} {
  const stored = loadStorageOverrides()
  const envApproval = envBool('LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL', false)
  const envPublicNames = envBool('LAB_ALLOCATION_PUBLIC_NAMES', false)

  const requireAdminApproval = stored?.requireAdminApproval ?? 'auto'
  const publicNames = stored?.publicNames ?? 'auto'

  return {
    requireAdminApproval,
    publicNames,
    env: {
      requireAdminApproval: envApproval,
      publicNames: envPublicNames,
    },
    effective: {
      requireAdminApproval: resolveEffective(requireAdminApproval, envApproval),
      publicNames: resolveEffective(publicNames, envPublicNames),
    },
  }
}

export function isRuntimePublicNamesEnabled(): boolean {
  return getLabRuntimeSettings().effective.publicNames
}

export function isRuntimeRequireAdminApproval(): boolean {
  return getLabRuntimeSettings().effective.requireAdminApproval
}

export function saveLabRuntimeSettings(patch: LabRuntimeSettingsStorage): LabRuntimeSettingsStorage {
  const path = storagePath()
  const current = loadStorageOverrides() ?? {
    requireAdminApproval: 'auto' as PolicyMode,
    publicNames: 'auto' as PolicyMode,
  }
  const next: LabRuntimeSettingsStorage = { ...current }

  if (patch.requireAdminApproval !== undefined) {
    next.requireAdminApproval = patch.requireAdminApproval
  }
  if (patch.publicNames !== undefined) {
    next.publicNames = patch.publicNames
  }

  const pinned =
    next.requireAdminApproval !== 'auto' || next.publicNames !== 'auto'

  if (!pinned) {
    if (existsSync(path)) unlinkSync(path)
    return { requireAdminApproval: 'auto', publicNames: 'auto' }
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

/** Restaura políticas para `auto` (respeita `.env`). Usado no seed. */
export function resetLabRuntimeSettingsToAuto(): void {
  const path = storagePath()
  if (existsSync(path)) unlinkSync(path)
}
