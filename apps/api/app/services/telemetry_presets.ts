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
  return out
}

function mergeProfile(
  base: TelemetryPresetProfile,
  patch?: Partial<TelemetryPresetProfile> | null
): TelemetryPresetProfile {
  if (!patch) return { ...base, telemetrySet: { ...base.telemetrySet } }
  return {
    intervalSeconds:
      typeof patch.intervalSeconds === 'number' ? patch.intervalSeconds : base.intervalSeconds,
    batchSize: typeof patch.batchSize === 'number' ? patch.batchSize : base.batchSize,
    telemetrySet: mergeTelemetrySet(base.telemetrySet, patch.telemetrySet),
  }
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

  return { fast, eco }
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
  const path = storagePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(presets, null, 2), 'utf-8')
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
    return {
      intervalSeconds: customConfig.intervalSeconds ?? (isOccupied ? 5 : 60),
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
