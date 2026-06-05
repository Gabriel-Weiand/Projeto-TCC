import { DateTime } from 'luxon'
import { labTelemetryPublicConfig } from '#services/telemetry_presets'
import { LAB_ENV_LIMITS } from '#services/lab_env_limits'
import {
  isRuntimePublicNamesEnabled,
  isRuntimeRequireAdminApproval,
} from '#services/lab_runtime_settings'

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

function envIntClamped(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return clampInt(n, min, max)
}

/** Inteiro ≥ min; valores inválidos usam fallback. */
function envIntAllowZero(key: string, fallback: number, min = 0, max = 999_999): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return clampInt(n, min, max)
}

function envString(key: string, fallback: string): string {
  const raw = process.env[key]?.trim()
  return raw && raw.length > 0 ? raw : fallback
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

/** Nomes dos responsáveis visíveis no calendário para usuários não-admin. */
export function isAllocationPublicNamesEnabled(): boolean {
  return isRuntimePublicNamesEnabled()
}

/** Admin sempre vê; demais usuários conforme publicNames (runtime ou env). */
export function canSeeAllocationOwnerNames(userRole: string): boolean {
  return userRole === 'admin' || isAllocationPublicNamesEnabled()
}

function envIntList(key: string, fallback: number[], min: number, max: number): number[] {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => clampInt(n, min, max))
    .slice(0, LAB_ENV_LIMITS.calendar.futureDaysOptionsMaxItems)
  return parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => a - b) : fallback
}

function envScheduleHour(key: string, fallback: number): number {
  return envIntClamped(
    key,
    fallback,
    LAB_ENV_LIMITS.allocation.scheduleHour.min,
    LAB_ENV_LIMITS.allocation.scheduleHour.max
  )
}

const FUTURE_OPTIONS = envIntList(
  'LAB_CALENDAR_FUTURE_DAYS_OPTIONS',
  [90, 180, 365],
  LAB_ENV_LIMITS.calendar.futureDaysOption.min,
  LAB_ENV_LIMITS.calendar.futureDaysOption.max
)
const DEFAULT_FUTURE = envIntClamped(
  'LAB_CALENDAR_DEFAULT_FUTURE_DAYS',
  FUTURE_OPTIONS[0] ?? 90,
  LAB_ENV_LIMITS.calendar.defaultFutureDays.min,
  LAB_ENV_LIMITS.calendar.defaultFutureDays.max
)

function normalizeDefaultFuture(): number {
  if (FUTURE_OPTIONS.includes(DEFAULT_FUTURE)) return DEFAULT_FUTURE
  return FUTURE_OPTIONS[0] ?? 90
}

const scheduleStartHour = envScheduleHour('LAB_SCHEDULE_START_HOUR', 0)
const scheduleEndHour = envScheduleHour('LAB_SCHEDULE_END_HOUR', 24)

/**
 * Configuração operacional do laboratório (env + defaults + runtime settings).
 * Variáveis documentadas em apps/api/.env.example e MODULE.md.
 */
export const labConfig = {
  timezone: envString('TZ', 'America/Sao_Paulo'),

  auth: {
    tokenExpiresIn: envString('LAB_AUTH_TOKEN_EXPIRES_IN', '6 hours'),
  },

  calendar: {
    pastDays: envIntClamped(
      'LAB_CALENDAR_PAST_DAYS',
      30,
      LAB_ENV_LIMITS.calendar.pastDays.min,
      LAB_ENV_LIMITS.calendar.pastDays.max
    ),
    futureDaysOptions: FUTURE_OPTIONS,
    defaultFutureDays: normalizeDefaultFuture(),
  },

  allocation: {
    maxFutureDays: envIntClamped(
      'LAB_ALLOCATION_MAX_FUTURE_DAYS',
      365,
      LAB_ENV_LIMITS.allocation.maxFutureDays.min,
      LAB_ENV_LIMITS.allocation.maxFutureDays.max
    ),
    minDurationMinutes: envIntClamped(
      'LAB_ALLOCATION_MIN_DURATION_MINUTES',
      15,
      LAB_ENV_LIMITS.allocation.minDurationMinutes.min,
      LAB_ENV_LIMITS.allocation.minDurationMinutes.max
    ),
    scheduleStartHour,
    scheduleEndHour,
    publicNames: isAllocationPublicNamesEnabled(),
    graceMinutes: envIntAllowZero(
      'LAB_ALLOCATION_GRACE_MINUTES',
      10,
      LAB_ENV_LIMITS.allocation.graceMinutes.min,
      LAB_ENV_LIMITS.allocation.graceMinutes.max
    ),
    postSftpMinutes: envIntAllowZero(
      'LAB_ALLOCATION_POST_SFTP_MINUTES',
      1440,
      LAB_ENV_LIMITS.allocation.postSftpMinutes.min,
      LAB_ENV_LIMITS.allocation.postSftpMinutes.max
    ),
    deleteUserDays: envIntClamped(
      'LAB_ALLOCATION_DELETE_USER_DAYS',
      7,
      LAB_ENV_LIMITS.allocation.deleteUserDays.min,
      LAB_ENV_LIMITS.allocation.deleteUserDays.max
    ),
    prepareMinutes: envIntAllowZero(
      'LAB_ALLOCATION_PREPARE_MINUTES',
      5,
      LAB_ENV_LIMITS.allocation.prepareMinutes.min,
      LAB_ENV_LIMITS.allocation.prepareMinutes.max
    ),
  },

  maintenance: {
    summarizeAfterHours: envIntClamped(
      'LAB_SUMMARIZE_AFTER_HOURS',
      168,
      LAB_ENV_LIMITS.maintenance.summarizeAfterHours.min,
      LAB_ENV_LIMITS.maintenance.summarizeAfterHours.max
    ),
    pruneAllocationDays: envIntClamped(
      'LAB_PRUNE_ALLOCATION_DAYS',
      30,
      LAB_ENV_LIMITS.maintenance.pruneDays.min,
      LAB_ENV_LIMITS.maintenance.pruneDays.max
    ),
    pruneNotificationDays: envIntClamped(
      'LAB_PRUNE_NOTIFICATION_DAYS',
      30,
      LAB_ENV_LIMITS.maintenance.pruneDays.min,
      LAB_ENV_LIMITS.maintenance.pruneDays.max
    ),
    pruneSshAttemptsDays: envIntClamped(
      'LAB_PRUNE_SSH_ATTEMPTS_DAYS',
      30,
      LAB_ENV_LIMITS.maintenance.pruneDays.min,
      LAB_ENV_LIMITS.maintenance.pruneDays.max
    ),
  },

  schedulers: {
    maintenanceCron: envString('LAB_SCHEDULER_MAINTENANCE_CRON', '0 */4 * * *'),
    autoFinalizeCron: envString('LAB_SCHEDULER_AUTO_FINALIZE_CRON', '*/5 * * * *'),
  },

  notifications: {
    upcomingMinutes: envIntClamped(
      'LAB_NOTIF_UPCOMING_MINUTES',
      10,
      LAB_ENV_LIMITS.notifications.upcomingMinutes.min,
      LAB_ENV_LIMITS.notifications.upcomingMinutes.max
    ),
    sshKeyReminderMinutes: envIntClamped(
      'LAB_NOTIF_SSH_KEY_MINUTES',
      5,
      LAB_ENV_LIMITS.notifications.sshKeyMinutes.min,
      LAB_ENV_LIMITS.notifications.sshKeyMinutes.max
    ),
    sshFailureFlood: {
      windowMinutes: envIntClamped(
        'LAB_NOTIF_SSH_FLOOD_WINDOW_MINUTES',
        15,
        LAB_ENV_LIMITS.notifications.sshFloodWindowMinutes.min,
        LAB_ENV_LIMITS.notifications.sshFloodWindowMinutes.max
      ),
      threshold: envIntClamped(
        'LAB_NOTIF_SSH_FLOOD_THRESHOLD',
        20,
        LAB_ENV_LIMITS.notifications.sshFloodThreshold.min,
        LAB_ENV_LIMITS.notifications.sshFloodThreshold.max
      ),
      cooldownHours: envIntClamped(
        'LAB_NOTIF_SSH_FLOOD_COOLDOWN_HOURS',
        1,
        LAB_ENV_LIMITS.notifications.sshFloodCooldownHours.min,
        LAB_ENV_LIMITS.notifications.sshFloodCooldownHours.max
      ),
    },
    agentOffline: {
      offlineMinutes: envIntClamped(
        'LAB_NOTIF_AGENT_OFFLINE_MINUTES',
        10,
        LAB_ENV_LIMITS.notifications.agentOfflineMinutes.min,
        LAB_ENV_LIMITS.notifications.agentOfflineMinutes.max
      ),
      cooldownHours: envIntClamped(
        'LAB_NOTIF_AGENT_OFFLINE_COOLDOWN_HOURS',
        24,
        LAB_ENV_LIMITS.notifications.agentOfflineCooldownHours.min,
        LAB_ENV_LIMITS.notifications.agentOfflineCooldownHours.max
      ),
    },
  },
} as const

export function labNow(): DateTime {
  return DateTime.now().setZone(labConfig.timezone)
}

export function labTodayIso(): string {
  return labNow().toISODate()!
}

/** Payload público para front e agentes (sem segredos). */
export function labPublicConfig() {
  const now = labNow()
  return {
    timezone: labConfig.timezone,
    now: {
      utc: DateTime.utc().toISO()!,
      unixMs: DateTime.utc().toMillis(),
      localIso: now.toISO()!,
      localDate: now.toISODate()!,
    },
    calendar: { ...labConfig.calendar },
    allocation: {
      ...labConfig.allocation,
      publicNames: isAllocationPublicNamesEnabled(),
      access: {
        graceMinutes: labConfig.allocation.graceMinutes,
        postSftpMinutes: labConfig.allocation.postSftpMinutes,
        graceEnabled: labConfig.allocation.graceMinutes > 0,
        postSftpEnabled: labConfig.allocation.postSftpMinutes > 0,
        deleteUserDays: labConfig.allocation.deleteUserDays,
        prepareMinutes: labConfig.allocation.prepareMinutes,
      },
      requireAdminApproval: isAllocationRequireAdminApproval(),
    },
    auth: {
      tokenExpiresIn: labConfig.auth.tokenExpiresIn,
    },
    telemetry: labTelemetryPublicConfig(),
    maintenance: {
      summarizeAfterHours: labConfig.maintenance.summarizeAfterHours,
      pruneAllocationDays: labConfig.maintenance.pruneAllocationDays,
      pruneNotificationDays: labConfig.maintenance.pruneNotificationDays,
      pruneSshAttemptsDays: labConfig.maintenance.pruneSshAttemptsDays,
    },
  }
}

/** Valida se endTime não ultrapassa o limite futuro (data civil do parque). */
export function assertAllocationEndWithinLimit(endTimeUtc: DateTime): string | null {
  const endLocal = endTimeUtc.setZone(labConfig.timezone)
  const maxLocal = labNow()
    .startOf('day')
    .plus({ days: labConfig.allocation.maxFutureDays })
    .endOf('day')

  if (endLocal > maxLocal) {
    return `A data de término não pode passar de ${labConfig.allocation.maxFutureDays} dias no futuro (fuso ${labConfig.timezone}).`
  }
  return null
}

/** Duração mínima da reserva (config LAB_ALLOCATION_MIN_DURATION_MINUTES). */
export function assertAllocationMinDuration(
  startTimeUtc: DateTime,
  endTimeUtc: DateTime
): string | null {
  const minutes = endTimeUtc.diff(startTimeUtc, 'minutes').minutes
  if (minutes < labConfig.allocation.minDurationMinutes) {
    return `A reserva deve ter pelo menos ${labConfig.allocation.minDurationMinutes} minutos de duração.`
  }
  return null
}

export function getLabAccessConfig() {
  const graceMinutes = labConfig.allocation.graceMinutes
  return {
    graceMinutes,
    gapMinutes: graceMinutes,
    postSftpMinutes: labConfig.allocation.postSftpMinutes,
    deleteUserDays: labConfig.allocation.deleteUserDays,
    prepareMinutes: labConfig.allocation.prepareMinutes,
  }
}

export function isAllocationRequireAdminApproval(): boolean {
  return isRuntimeRequireAdminApproval()
}

type AllocationStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'finished'

/** Status inicial ao criar reserva (usuário não pode forçar approved se exige aprovação). */
export function resolveInitialAllocationStatus(
  userRole: string,
  requestedStatus?: AllocationStatus
): 'pending' | 'approved' {
  if (userRole === 'admin') {
    if (requestedStatus === 'pending' || requestedStatus === 'approved') {
      return requestedStatus
    }
    return 'approved'
  }
  return isAllocationRequireAdminApproval() ? 'pending' : 'approved'
}
