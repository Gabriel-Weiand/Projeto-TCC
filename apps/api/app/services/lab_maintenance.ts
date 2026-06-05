import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import Notification from '#models/notification'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import { labConfig, labNow } from '#services/lab_config'
import { summarizeAllocation } from '#services/allocation_summarizer'
/** Statuses de alocações que não ocorrerão — elegíveis para prune por endTime. */
export const TERMINAL_ALLOCATION_STATUSES = ['finished', 'cancelled', 'denied'] as const

export type TerminalAllocationStatus = (typeof TERMINAL_ALLOCATION_STATUSES)[number]

export type PruneAllocationsOptions = {
  before?: DateTime
  status?: TerminalAllocationStatus[]
  userId?: number
  machineId?: number
}

export type PruneNotificationsOptions = {
  before?: DateTime
  userId?: number
}

export type PruneSshAttemptsOptions = {
  /** Mantém tentativas dos últimos N dias; remove as mais antigas. */
  keepDays?: number
  machineId?: number
}

function allocationPruneCutoff(override?: DateTime): DateTime {
  return override ?? labNow().minus({ days: labConfig.maintenance.pruneAllocationDays })
}

function notificationPruneCutoff(override?: DateTime): DateTime {
  return override ?? labNow().minus({ days: labConfig.maintenance.pruneNotificationDays })
}

function sshKeepDays(override?: number): number {
  return override ?? labConfig.maintenance.pruneSshAttemptsDays
}

/**
 * Remove tokens de acesso expirados.
 * Usa `Date` como o Adonis (`AccessToken.isExpired()`), não string SQL em UTC —
 * evita apagar sessões válidas quando expires_at foi gravado via Knex/Date.
 */
export async function pruneExpiredTokens(): Promise<number> {
  const result = await db.from('auth_access_tokens').where('expires_at', '<', new Date()).delete()
  return Array.isArray(result) ? (result[0] ?? 0) : Number(result ?? 0)
}

/**
 * Gera resumos (allocation_metrics) para alocações finalizadas cuja endTime
 * é anterior a (agora − LAB_SUMMARIZE_AFTER_HOURS).
 */
export async function summarizeDueAllocations(): Promise<number> {
  const cutoff = DateTime.utc().minus({ hours: labConfig.maintenance.summarizeAfterHours })

  const allocations = await Allocation.query()
    .where('status', 'finished')
    .where('endTime', '<', cutoff.toSQL()!)

  let count = 0
  for (const allocation of allocations) {
    const metric = await summarizeAllocation(allocation)
    if (metric) count++
  }
  return count
}

/**
 * Remove alocações terminais cuja endTime é anterior ao corte (padrão: LAB_PRUNE_ALLOCATION_DAYS).
 * Telemetrias e métricas são removidas em CASCADE.
 */
export async function pruneAllocations(options: PruneAllocationsOptions = {}): Promise<number> {
  const before = allocationPruneCutoff(options.before)
  const status = options.status ?? [...TERMINAL_ALLOCATION_STATUSES]

  let query = Allocation.query()
    .where('endTime', '<', before.toSQL()!)
    .whereIn('status', status)

  if (options.userId) {
    query = query.where('userId', options.userId)
  }
  if (options.machineId) {
    query = query.where('machineId', options.machineId)
  }

  const deleted = await query.delete()
  return deleted[0] ?? 0
}

/**
 * Remove notificações cuja createdAt é anterior ao corte (padrão: LAB_PRUNE_NOTIFICATION_DAYS).
 */
export async function pruneNotifications(options: PruneNotificationsOptions = {}): Promise<number> {
  const before = notificationPruneCutoff(options.before)

  let query = Notification.query().where('createdAt', '<', before.toSQL()!)

  if (options.userId) {
    query = query.where('userId', options.userId)
  }

  const deleted = await query.delete()
  return deleted[0] ?? 0
}

/**
 * Remove tentativas SSH mais antigas que o intervalo de retenção (padrão: LAB_PRUNE_SSH_ATTEMPTS_DAYS).
 * Ex.: keepDays=4 → apaga registros com createdAt anterior a 4 dias atrás.
 */
export async function pruneSshAttempts(options: PruneSshAttemptsOptions = {}): Promise<number> {
  const keepDays = sshKeepDays(options.keepDays)
  const before = labNow().minus({ days: keepDays })

  let query = SshConnectionAttempt.query().where('createdAt', '<', before.toSQL()!)

  if (options.machineId) {
    query = query.where('machineId', options.machineId)
  }

  const deleted = await query.delete()
  return deleted[0] ?? 0
}

export type MaintenanceRunResult = {
  tokens: number
  summarized: number
  allocations: number
  notifications: number
  sshAttempts: number
}

/**
 * Executa todas as tarefas de manutenção sistemática (cron ou trigger manual).
 */
export async function runLabMaintenance(): Promise<MaintenanceRunResult> {
  return {
    tokens: await pruneExpiredTokens(),
    summarized: await summarizeDueAllocations(),
    allocations: await pruneAllocations(),
    notifications: await pruneNotifications(),
    sshAttempts: await pruneSshAttempts(),
  }
}
