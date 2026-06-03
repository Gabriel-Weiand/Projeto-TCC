import app from '@adonisjs/core/services/app'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type Machine from '#models/machine'

export type TelemetrySetConfig = {
  cpu: boolean
  gpu: boolean
  ramAndSwap: boolean
  diskSpace: boolean
  diskIO: boolean
  networkIO: boolean
  temperatures: boolean
  activeUsers: boolean
}

export type TelemetryPresetProfile = {
  intervalSeconds: number
  batchSize: number
  telemetrySet: TelemetrySetConfig
}

export type LabTelemetryPresets = {
  fast: TelemetryPresetProfile
  eco: TelemetryPresetProfile
}

/** Intervalo entre capturas enviadas ao agente (segundos). */
export const TELEMETRY_INTERVAL_MIN = 1
export const TELEMETRY_INTERVAL_MAX = 600

/** Sempre coletadas em fast, eco e custom (não podem ser desligadas). */
export const MANDATORY_TELEMETRY_METRICS = ['cpu', 'ramAndSwap'] as const satisfies readonly (keyof TelemetrySetConfig)[]

/** Métricas que o agente suporta coletar. */
export const FULL_TELEMETRY_SET: TelemetrySetConfig = {
  cpu: true,
  gpu: true,
  ramAndSwap: true,
  diskSpace: true,
  diskIO: true,
  networkIO: true,
  temperatures: true,
  activeUsers: true,
}

const ECO_TELEMETRY_SET: TelemetrySetConfig = {
  cpu: true,
  gpu: false,
  ramAndSwap: true,
  diskSpace: true,
  diskIO: false,
  networkIO: false,
  temperatures: false,
  activeUsers: true,
}

/** Valores padrão do laboratório (sobrescritos por storage ou env). */
export const DEFAULT_LAB_TELEMETRY_PRESETS: LabTelemetryPresets = {
  fast: {
    intervalSeconds: 30,
    batchSize: 4,
    telemetrySet: { ...FULL_TELEMETRY_SET },
  },
  eco: {
    intervalSeconds: 60,
    batchSize: 15,
    telemetrySet: { ...ECO_TELEMETRY_SET },
  },
}

const TELEMETRY_SET_KEYS = Object.keys(FULL_TELEMETRY_SET) as (keyof TelemetrySetConfig)[]

export function clampTelemetryInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return TELEMETRY_INTERVAL_MIN
  return Math.min(
    TELEMETRY_INTERVAL_MAX,
    Math.max(TELEMETRY_INTERVAL_MIN, Math.round(seconds))
  )
}

export function normalizeTelemetrySet(set: TelemetrySetConfig): TelemetrySetConfig {
  const out = { ...set }
  for (const key of MANDATORY_TELEMETRY_METRICS) {
    out[key] = true
  }
  return out
}

export function normalizePresetProfile(profile: TelemetryPresetProfile): TelemetryPresetProfile {
  return {
    intervalSeconds: clampTelemetryInterval(profile.intervalSeconds),
    batchSize: profile.batchSize,
    telemetrySet: normalizeTelemetrySet(profile.telemetrySet),
  }
}

export function normalizeLabTelemetryPresets(presets: LabTelemetryPresets): LabTelemetryPresets {
  return {
    fast: normalizePresetProfile(presets.fast),
    eco: normalizePresetProfile(presets.eco),
  }
}

export function normalizeCustomAgentConfig(
  config: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!config) return config
  const out = { ...config }
  if (typeof out.intervalSeconds === 'number') {
    out.intervalSeconds = clampTelemetryInterval(out.intervalSeconds)
  }
  if (out.telemetrySet && typeof out.telemetrySet === 'object') {
    out.telemetrySet = normalizeTelemetrySet({
      ...FULL_TELEMETRY_SET,
      ...(out.telemetrySet as Partial<TelemetrySetConfig>),
    })
  }
  return out
}

function envJson<T>(key: string): T | null {
  const raw = process.env[key]?.trim()
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function storagePath(): string {
  return app.makePath('storage/lab/telemetry_presets.json')
}

function mergeTelemetrySet(
  base: TelemetrySetConfig,
  patch?: Partial<TelemetrySetConfig> | null
): TelemetrySetConfig {
  const out = { ...base }
  if (!patch) return out
  for (const key of TELEMETRY_SET_KEYS) {
    if (typeof patch[key] === 'boolean') {
      out[key] = patch[key]!
    }
  }
  return normalizeTelemetrySet(out)
}

function mergeProfile(
  base: TelemetryPresetProfile,
  patch?: Partial<TelemetryPresetProfile> | null
): TelemetryPresetProfile {
  if (!patch) return normalizePresetProfile({ ...base, telemetrySet: { ...base.telemetrySet } })
  return normalizePresetProfile({
    intervalSeconds:
      typeof patch.intervalSeconds === 'number' ? patch.intervalSeconds : base.intervalSeconds,
    batchSize: typeof patch.batchSize === 'number' ? patch.batchSize : base.batchSize,
    telemetrySet: mergeTelemetrySet(base.telemetrySet, patch.telemetrySet),
  })
}

function loadStorageOverrides(): Partial<LabTelemetryPresets> | null {
  const path = storagePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LabTelemetryPresets>
    return parsed
  } catch {
    return null
  }
}

/** Perfis fast/eco efetivos (defaults → env → arquivo em storage). */
export function getLabTelemetryPresets(): LabTelemetryPresets {
  let fast = mergeProfile(DEFAULT_LAB_TELEMETRY_PRESETS.fast, envJson('LAB_TELEMETRY_FAST'))
  let eco = mergeProfile(DEFAULT_LAB_TELEMETRY_PRESETS.eco, envJson('LAB_TELEMETRY_ECO'))

  const stored = loadStorageOverrides()
  if (stored?.fast) fast = mergeProfile(fast, stored.fast)
  if (stored?.eco) eco = mergeProfile(eco, stored.eco)

  return normalizeLabTelemetryPresets({ fast, eco })
}

/** Payload público (agente offline + front). */
export function labTelemetryPublicConfig() {
  const presets = getLabTelemetryPresets()
  return {
    defaultOfflinePreset: 'eco' as const,
    presets,
  }
}

export function saveLabTelemetryPresets(presets: LabTelemetryPresets): void {
  const normalized = normalizeLabTelemetryPresets(presets)
  const path = storagePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(normalized, null, 2), 'utf-8')
}

/**
 * Monta `agentConfig.telemetry` para heartbeat conforme preset da máquina.
 */
export function buildAgentTelemetryConfig(
  machine: Machine,
  isOccupied: boolean
): Record<string, unknown> {
  const preset = machine.telemetryPreset || 'eco'
  const customConfig = machine.customAgentConfig || {}
  const labPresets = getLabTelemetryPresets()

  if (preset === 'custom') {
    const intervalSeconds = clampTelemetryInterval(
      typeof customConfig.intervalSeconds === 'number'
        ? customConfig.intervalSeconds
        : isOccupied
          ? 5
          : 60
    )
    return {
      intervalSeconds,
      batchSize: customConfig.batchSize ?? (isOccupied ? 5 : 15),
      telemetryPreset: 'custom',
      telemetrySet: mergeTelemetrySet(
        FULL_TELEMETRY_SET,
        customConfig.telemetrySet as Partial<TelemetrySetConfig> | undefined
      ),
      onDemandProcessConfig: customConfig.onDemandProcessConfig ?? null,
    }
  }

  const profile = labPresets[preset] ?? labPresets.eco
  return {
    intervalSeconds: profile.intervalSeconds,
    batchSize: profile.batchSize,
    telemetryPreset: preset,
    telemetrySet: { ...profile.telemetrySet },
    onDemandProcessConfig: customConfig.onDemandProcessConfig ?? null,
  }
}
