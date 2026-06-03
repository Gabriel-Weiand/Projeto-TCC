import { DateTime } from 'luxon'
import { labTelemetryPublicConfig } from '#services/telemetry_presets'

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
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
  return envBool('LAB_ALLOCATION_PUBLIC_NAMES', false)
}

/** Admin sempre vê; demais usuários conforme LAB_ALLOCATION_PUBLIC_NAMES. */
export function canSeeAllocationOwnerNames(userRole: string): boolean {
  return userRole === 'admin' || isAllocationPublicNamesEnabled()
}

function envIntList(key: string, fallback: number[]): number[] {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
  return parsed.length > 0 ? parsed : fallback
}

const FUTURE_OPTIONS = envIntList('LAB_CALENDAR_FUTURE_DAYS_OPTIONS', [90, 180, 365])
const DEFAULT_FUTURE = envInt('LAB_CALENDAR_DEFAULT_FUTURE_DAYS', FUTURE_OPTIONS[0] ?? 90)

function normalizeDefaultFuture(): number {
  if (FUTURE_OPTIONS.includes(DEFAULT_FUTURE)) return DEFAULT_FUTURE
  return FUTURE_OPTIONS[0] ?? 90
}

/**
 * Configuração operacional do laboratório (env + defaults).
 * Variáveis documentadas em apps/api/.env.example
 */
export const labConfig = {
  timezone: envString('TZ', 'America/Sao_Paulo'),

  auth: {
    tokenExpiresIn: envString('LAB_AUTH_TOKEN_EXPIRES_IN', '6 hours'),
  },

  calendar: {
    pastDays: envInt('LAB_CALENDAR_PAST_DAYS', 30),
    futureDaysOptions: FUTURE_OPTIONS,
    defaultFutureDays: normalizeDefaultFuture(),
  },

  allocation: {
    maxFutureDays: envInt('LAB_ALLOCATION_MAX_FUTURE_DAYS', 365),
    minDurationMinutes: envInt('LAB_ALLOCATION_MIN_DURATION_MINUTES', 15),
    /** Horário local do parque (0–24) para reservas; 0 e 24 = sem restrição de faixa */
    scheduleStartHour: envInt('LAB_SCHEDULE_START_HOUR', 0),
    scheduleEndHour: envInt('LAB_SCHEDULE_END_HOUR', 24),
    /** true = calendário/histórico da máquina exibe quem reservou; false = só admin */
    publicNames: isAllocationPublicNamesEnabled(),
    /**
     * Minutos de bash após endTime (somente `approved`; finish manual não usa grace).
     * Também define o intervalo mínimo entre reservas na mesma máquina (conflito de calendário).
     */
    graceMinutes: envInt('LAB_ALLOCATION_GRACE_MINUTES', 10),
    /** SFTP com chave após fim (+ grace se natural) */
    postSftpMinutes: envInt('LAB_ALLOCATION_POST_SFTP_MINUTES', 1440),
    /** Dias após endTime até remover conta no SO (via drift) */
    deleteUserDays: envInt('LAB_ALLOCATION_DELETE_USER_DAYS', 7),
    /** Provisionamento antecipado (T-5) antes do início */
    prepareMinutes: envInt('LAB_ALLOCATION_PREPARE_MINUTES', 5),
  },

  schedulers: {
    pruneTokensCron: envString('LAB_SCHEDULER_PRUNE_TOKENS_CRON', '0 3 * * *'),
    autoFinalizeCron: envString('LAB_SCHEDULER_AUTO_FINALIZE_CRON', '*/5 * * * *'),
  },

  notifications: {
    /** Lembrete "reserva em breve" (minutos antes do início) */
    upcomingMinutes: envInt('LAB_NOTIF_UPCOMING_MINUTES', 10),
    /** Verificação de chave SSH (minutos antes do início) */
    sshKeyReminderMinutes: envInt('LAB_NOTIF_SSH_KEY_MINUTES', 5),
    sshFailureFlood: {
      windowMinutes: envInt('LAB_NOTIF_SSH_FLOOD_WINDOW_MINUTES', 15),
      threshold: envInt('LAB_NOTIF_SSH_FLOOD_THRESHOLD', 20),
      cooldownHours: envInt('LAB_NOTIF_SSH_FLOOD_COOLDOWN_HOURS', 1),
    },
    agentOffline: {
      /** Sem heartbeat neste intervalo → candidata a alerta (máquina available/occupied) */
      offlineMinutes: envInt('LAB_NOTIF_AGENT_OFFLINE_MINUTES', 10),
      /** Máximo 1 alerta por máquina neste intervalo (evita flood; reforça manutenção/retirada do parque) */
      cooldownHours: envInt('LAB_NOTIF_AGENT_OFFLINE_COOLDOWN_HOURS', 24),
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
        deleteUserDays: labConfig.allocation.deleteUserDays,
        prepareMinutes: labConfig.allocation.prepareMinutes,
      },
      requireAdminApproval: isAllocationRequireAdminApproval(),
    },
    auth: {
      tokenExpiresIn: labConfig.auth.tokenExpiresIn,
    },
    telemetry: labTelemetryPublicConfig(),
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

/** Ponto único para evoluir para config em DB/API depois. */
export function getLabAccessConfig() {
  const graceMinutes = labConfig.allocation.graceMinutes
  return {
    graceMinutes,
    /** Igual a grace — intervalo mínimo entre reservas (calendário). */
    gapMinutes: graceMinutes,
    postSftpMinutes: labConfig.allocation.postSftpMinutes,
    deleteUserDays: labConfig.allocation.deleteUserDays,
    prepareMinutes: labConfig.allocation.prepareMinutes,
  }
}

export function isAllocationRequireAdminApproval(): boolean {
  return envBool('LAB_ALLOCATION_REQUIRE_ADMIN_APPROVAL', false)
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
