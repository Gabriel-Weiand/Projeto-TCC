import app from '@adonisjs/core/services/app'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type Machine from '#models/machine'

export type ProcessCaptureCompareMetric =
  | 'cpuPercent'
  | 'ramMb'
  | 'vramMb'
  | 'gpuUse'
  | 'diskReadKbps'
  | 'diskWriteKbps'

export type ProcessCaptureUserScope = 'session' | 'all'

export type ProcessCaptureConfig = {
  compareMetric: ProcessCaptureCompareMetric
  topX: number
  userScope: ProcessCaptureUserScope
}

export type TelemetrySetConfig = {
  cpu: boolean
  gpu: boolean
  ramAndSwap: boolean
  disk: boolean
  networkIO: boolean
  temperatures: boolean
  activeUsers: boolean
  processCapture: boolean
}

export type TelemetryPresetProfile = {
  intervalSeconds: number
  batchSize: number
  telemetrySet: TelemetrySetConfig
  processCaptureConfig: ProcessCaptureConfig
}

export type LabTelemetryPresets = {
  fast: TelemetryPresetProfile
  eco: TelemetryPresetProfile
}

/** Intervalo máximo entre capturas enviadas ao agente (segundos). Alinha grade do gráfico resumido. */
export const TELEMETRY_INTERVAL_MAX = 300
/** Perfis globais fast/eco. */
export const TELEMETRY_PRESET_INTERVAL_MIN = 10
/** Config custom por máquina. */
export const TELEMETRY_CUSTOM_INTERVAL_MIN = 2

/** Sempre coletadas em fast, eco e custom (não podem ser desligadas). */
export const MANDATORY_TELEMETRY_METRICS = ['cpu', 'ramAndSwap'] as const satisfies readonly (keyof TelemetrySetConfig)[]

export const DEFAULT_PROCESS_CAPTURE_CONFIG: ProcessCaptureConfig = {
  compareMetric: 'cpuPercent',
  topX: 10,
  userScope: 'session',
}

/** Limite máximo de processos retornados por amostra (preset ou personalizado). */
export const TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX = 100

/**
 * cpuPercent de processo no wire format (% da capacidade total do host × 10).
 * O agente normaliza o valor bruto do psutil (soma por núcleo) antes de enviar.
 */
export const TELEMETRY_PROCESS_CPU_PERCENT_WIRE_MAX = 1000

/** Métricas que o agente suporta coletar. */
export const FULL_TELEMETRY_SET: TelemetrySetConfig = {
  cpu: true,
  gpu: true,
  ramAndSwap: true,
  disk: true,
  networkIO: true,
  temperatures: true,
  activeUsers: true,
  processCapture: false,
}

const ECO_TELEMETRY_SET: TelemetrySetConfig = {
  cpu: true,
  gpu: false,
  ramAndSwap: true,
  disk: true,
  networkIO: false,
  temperatures: false,
  activeUsers: true,
  processCapture: false,
}

/** Valores padrão do laboratório (sobrescritos por storage ou env). */
export const DEFAULT_LAB_TELEMETRY_PRESETS: LabTelemetryPresets = {
  fast: {
    intervalSeconds: 30,
    batchSize: 4,
    telemetrySet: { ...FULL_TELEMETRY_SET },
    processCaptureConfig: { ...DEFAULT_PROCESS_CAPTURE_CONFIG },
  },
  eco: {
    intervalSeconds: 60,
    batchSize: 15,
    telemetrySet: { ...ECO_TELEMETRY_SET },
    processCaptureConfig: { ...DEFAULT_PROCESS_CAPTURE_CONFIG },
  },
}

const TELEMETRY_SET_KEYS = Object.keys(FULL_TELEMETRY_SET) as (keyof TelemetrySetConfig)[]

export function clampTelemetryInterval(
  seconds: number,
  min = TELEMETRY_PRESET_INTERVAL_MIN
): number {
  if (!Number.isFinite(seconds)) return min
  return Math.min(TELEMETRY_INTERVAL_MAX, Math.max(min, Math.round(seconds)))
}

export function clampCustomTelemetryInterval(seconds: number): number {
  return clampTelemetryInterval(seconds, TELEMETRY_CUSTOM_INTERVAL_MIN)
}

export function normalizeTelemetrySet(
  set: Partial<TelemetrySetConfig> & { diskSpace?: boolean; diskIO?: boolean }
): TelemetrySetConfig {
  const legacyDisk =
    typeof set.disk === 'boolean' ? set.disk : !!(set.diskSpace || set.diskIO)
  const out: TelemetrySetConfig = {
    ...FULL_TELEMETRY_SET,
    ...set,
    disk: legacyDisk,
    processCapture: set.processCapture === true,
  }
  for (const key of MANDATORY_TELEMETRY_METRICS) {
    out[key] = true
  }
  return out
}

export function normalizeProcessCaptureConfig(
  config?: Partial<ProcessCaptureConfig> | null
): ProcessCaptureConfig {
  const compareMetric = config?.compareMetric
  const allowed: ProcessCaptureCompareMetric[] = [
    'cpuPercent',
    'ramMb',
    'vramMb',
    'gpuUse',
    'diskReadKbps',
    'diskWriteKbps',
  ]
  const topX =
    typeof config?.topX === 'number'
      ? Math.min(TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX, Math.max(1, Math.round(config.topX)))
      : 10
  const userScope: ProcessCaptureUserScope =
    config?.userScope === 'all' || config?.userScope === 'session' ? config.userScope : 'session'
  return {
    compareMetric: allowed.includes(compareMetric as ProcessCaptureCompareMetric)
      ? (compareMetric as ProcessCaptureCompareMetric)
      : 'cpuPercent',
    topX,
    userScope,
  }
}

export function normalizePresetProfile(profile: TelemetryPresetProfile): TelemetryPresetProfile {
  return {
    intervalSeconds: clampTelemetryInterval(profile.intervalSeconds),
    batchSize: profile.batchSize,
    telemetrySet: normalizeTelemetrySet(profile.telemetrySet),
    processCaptureConfig: normalizeProcessCaptureConfig(profile.processCaptureConfig),
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
    out.intervalSeconds = clampCustomTelemetryInterval(out.intervalSeconds)
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
  if (!patch) {
    return normalizePresetProfile({
      ...base,
      telemetrySet: { ...base.telemetrySet },
      processCaptureConfig: { ...base.processCaptureConfig },
    })
  }
  return normalizePresetProfile({
    intervalSeconds:
      typeof patch.intervalSeconds === 'number' ? patch.intervalSeconds : base.intervalSeconds,
    batchSize: typeof patch.batchSize === 'number' ? patch.batchSize : base.batchSize,
    telemetrySet: mergeTelemetrySet(base.telemetrySet, patch.telemetrySet),
    processCaptureConfig: {
      ...base.processCaptureConfig,
      ...(patch.processCaptureConfig ?? {}),
    },
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

/** Valor em `machines.telemetry_preset` que indica coleta automática (fast/eco por fase). */
export const MACHINE_TELEMETRY_AUTO_DB_PRESET = 'eco' as const

export function isMachineTelemetryCustom(machine: Machine): boolean {
  return machine.telemetryPreset === 'custom'
}

/**
 * Perfil efetivo no heartbeat: fast com alocação ativa, eco ociosa.
 * Ignora `fast`/`eco` gravados na máquina (legado) — só `custom` é fixo por máquina.
 */
export function resolveRuntimeTelemetryPreset(
  machine: Machine,
  isInAllocation: boolean
): 'fast' | 'eco' {
  if (isMachineTelemetryCustom(machine)) {
    return 'eco'
  }
  return isInAllocation ? 'fast' : 'eco'
}

/** Payload público (agente offline + front). */
export function labTelemetryPublicConfig() {
  const presets = getLabTelemetryPresets()
  return {
    defaultOfflinePreset: 'eco' as const,
    presets,
    collectionRules: {
      inAllocation: 'fast' as const,
      idle: 'eco' as const,
      perMachineOverride: 'custom' as const,
    },
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
/** Intervalo efetivo de captura da máquina (segundos). */
export function resolveMachineIntervalSeconds(
  machine: Machine,
  isInAllocation: boolean
): number {
  const config = buildAgentTelemetryConfig(machine, isInAllocation)
  return config.intervalSeconds as number
}

export function buildAgentTelemetryConfig(
  machine: Machine,
  isInAllocation: boolean
): Record<string, unknown> {
  const customConfig = machine.customAgentConfig || {}
  const labPresets = getLabTelemetryPresets()

  if (isMachineTelemetryCustom(machine)) {
    const intervalSeconds = clampCustomTelemetryInterval(
      typeof customConfig.intervalSeconds === 'number'
        ? customConfig.intervalSeconds
        : isInAllocation
          ? labPresets.fast.intervalSeconds
          : labPresets.eco.intervalSeconds
    )
    const customProcessCapture = customConfig.processCaptureConfig as
      | Partial<ProcessCaptureConfig>
      | undefined
    return {
      intervalSeconds,
      batchSize:
        customConfig.batchSize ??
        (isInAllocation ? labPresets.fast.batchSize : labPresets.eco.batchSize),
      telemetryPreset: 'custom',
      telemetryMode: 'custom',
      telemetrySet: mergeTelemetrySet(
        FULL_TELEMETRY_SET,
        customConfig.telemetrySet as Partial<TelemetrySetConfig> | undefined
      ),
      processCaptureConfig: normalizeProcessCaptureConfig(
        customProcessCapture ?? labPresets.fast.processCaptureConfig
      ),
      onDemandProcessConfig: customConfig.onDemandProcessConfig ?? null,
    }
  }

  const runtimePreset = resolveRuntimeTelemetryPreset(machine, isInAllocation)
  const profile = labPresets[runtimePreset]
  return {
    intervalSeconds: profile.intervalSeconds,
    batchSize: profile.batchSize,
    telemetryPreset: runtimePreset,
    telemetryMode: 'auto',
    telemetrySet: { ...profile.telemetrySet },
    processCaptureConfig: { ...profile.processCaptureConfig },
    onDemandProcessConfig: customConfig.onDemandProcessConfig ?? null,
  }
}
