import { DateTime } from 'luxon'
import Notification from '#models/notification'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import type AllocationModel from '#models/allocation'
import type MachineModel from '#models/machine'
import { labConfig } from '#services/lab_config'

function formatAllocationRange(start: DateTime, end: DateTime): string {
  const tz = labConfig.timezone
  const s = start.setZone(tz).toFormat('dd/MM/yyyy HH:mm')
  const e = end.setZone(tz).toFormat('dd/MM/yyyy HH:mm')
  return `${s} → ${e}`
}

/** Marcador na mensagem para deduplicação (delimitadores evitam colisão id 1 vs 12 no LIKE). */
function allocRef(allocationId: number): string {
  return `[alloc#${allocationId}#]`
}

function machineRef(machineId: number): string {
  return `[machine#${machineId}#]`
}

function hasSshPublicKey(user: User | null | undefined): boolean {
  return Boolean(user?.sshPublicKey?.trim())
}

async function alreadyNotified(userId: number, title: string, allocationId: number): Promise<boolean> {
  const ref = allocRef(allocationId)
  const row = await Notification.query()
    .where('userId', userId)
    .where('title', title)
    .where('message', 'like', `%${ref}%`)
    .first()
  return row !== null
}

/** Evita spam de alertas admin por máquina (flood SSH, agente offline). */
async function alreadyNotifiedAdminsForMachine(
  title: string,
  machineId: number,
  cooldownHours: number
): Promise<boolean> {
  const ref = machineRef(machineId)
  const sinceMs = DateTime.utc().minus({ hours: cooldownHours }).toMillis()

  // Compara em memória: SQLite mistura formatos ISO/local em `where createdAt >= ?`
  const rows = await Notification.query()
    .where('title', title)
    .where('message', 'like', `%${ref}%`)

  return rows.some((row) => row.createdAt.toUTC().toMillis() >= sinceMs)
}

/** Cria notificação na caixa de entrada do usuário. */
export async function notifyUser(userId: number, title: string, message: string) {
  return Notification.create({
    userId,
    title,
    message,
    isRead: false,
  })
}

async function notifyAllAdmins(title: string, message: string) {
  const admins = await User.query().where('role', 'admin')
  for (const admin of admins) {
    await notifyUser(admin.id, title, message)
  }
}

/** Admin: nova reserva pendente com sudo. */
export async function notifyAdminsPendingSudoAllocation(
  allocation: AllocationModel,
  machine: MachineModel
) {
  if (allocation.status !== 'pending' || !allocation.isSudo) return

  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  await notifyAllAdmins(
    'Nova reserva pendente (sudo)',
    `${allocRef(allocation.id)} Solicitação com privilégios sudo em ${machine.name} (${range}). Aprove ou negue em Alocações.`
  )
}

/** Admin: reserva sudo negada ou cancelada enquanto pendente. */
export async function notifyAdminsSudoAllocationOutcome(
  allocation: AllocationModel,
  machine: MachineModel,
  previousStatus: AllocationModel['status']
) {
  if (!allocation.isSudo) return

  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  const ref = allocRef(allocation.id)

  if (allocation.status === 'denied' && previousStatus === 'pending') {
    await notifyAllAdmins(
      'Reserva sudo negada',
      `${ref} Solicitação sudo em ${machine.name} (${range}) foi negada.`
    )
    return
  }

  if (allocation.status === 'cancelled' && previousStatus === 'pending') {
    await notifyAllAdmins(
      'Reserva sudo cancelada',
      `${ref} Solicitação sudo pendente em ${machine.name} (${range}) foi cancelada.`
    )
  }
}

/** User: só quando saiu de pending → approved (ex.: sudo aprovado pelo admin). */
export async function notifyAllocationApprovedFromPending(
  allocation: AllocationModel,
  machine: MachineModel,
  previousStatus: AllocationModel['status']
) {
  if (allocation.status !== 'approved' || previousStatus !== 'pending') return

  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  await notifyUser(
    allocation.userId,
    'Reserva aprovada',
    `${allocRef(allocation.id)} Sua reserva em ${machine.name} (${range}) foi aprovada.`
  )
}

/** User: reserva negada pelo admin. */
export async function notifyAllocationDenied(
  allocation: AllocationModel,
  machine: MachineModel
) {
  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  await notifyUser(
    allocation.userId,
    'Reserva negada',
    `${allocRef(allocation.id)} Sua reserva em ${machine.name} (${range}) foi negada.`
  )
}

/** User: cancelamento genérico. */
export async function notifyAllocationCancelled(
  allocation: AllocationModel,
  machine: MachineModel
) {
  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  await notifyUser(
    allocation.userId,
    'Reserva cancelada',
    `${allocRef(allocation.id)} A reserva em ${machine.name} (${range}) foi cancelada.`
  )
}

/** User: cancelamento por manutenção da máquina. */
export async function notifyAllocationCancelledDueToMaintenance(
  allocation: AllocationModel,
  machine: MachineModel
) {
  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  await notifyUser(
    allocation.userId,
    'Reserva cancelada (manutenção)',
    `${allocRef(allocation.id)} A reserva em ${machine.name} (${range}) foi cancelada porque a máquina entrou em manutenção.`
  )
}

/** User: sessão encerrada automaticamente pelo scheduler. */
export async function notifyAllocationAutoFinished(
  allocation: AllocationModel,
  machine: MachineModel
) {
  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  await notifyUser(
    allocation.userId,
    'Sessão encerrada',
    `${allocRef(allocation.id)} Sua sessão em ${machine.name} (${range}) foi finalizada automaticamente.`
  )
}

/** User: resumo de sessão disponível (admin gerou métricas). */
export async function notifySessionSummaryReady(
  allocation: AllocationModel,
  machine: MachineModel
) {
  const range = formatAllocationRange(allocation.startTime, allocation.endTime)
  await notifyUser(
    allocation.userId,
    'Resumo da sessão disponível',
    `${allocRef(allocation.id)} O resumo de uso em ${machine.name} (${range}) já pode ser consultado em Minhas alocações.`
  )
}

/** User: lembrete para cadastrar chave SSH ed25519 após criação da conta. */
export async function notifySshKeyRequired(userId: number) {
  await notifyUser(
    userId,
    'Cadastre sua chave SSH',
    'Para conectar às máquinas, adicione uma chave pública ed25519 no seu perfil (Acesso Remoto).'
  )
}

const TITLE_UPCOMING = 'Reserva em breve'
const TITLE_SSH_T5 = 'Chave SSH — reserva em 5 min'
const TITLE_SSH_T0 = 'Chave SSH — reserva iniciada'

async function notifyMissingSshKeyForAllocation(
  allocation: AllocationModel,
  machine: MachineModel,
  title: string,
  messageSuffix: string
): Promise<boolean> {
  await allocation.load('user')
  if (hasSshPublicKey(allocation.user)) return false
  if (await alreadyNotified(allocation.userId, title, allocation.id)) return false

  const startLocal = allocation.startTime.setZone(labConfig.timezone).toFormat('dd/MM/yyyy HH:mm')
  const machineName = machine.name ?? `Máquina #${allocation.machineId}`
  await notifyUser(
    allocation.userId,
    title,
    `${allocRef(allocation.id)} Cadastre uma chave ed25519 no perfil antes de conectar a ${machineName} (${startLocal}). ${messageSuffix}`
  )
  return true
}

/**
 * Scheduler: lembretes T-10, verificação de chave SSH em T-5 e T-0.
 * Reavalia a chave a cada marco (usuário pode cadastrar de última hora).
 */
export async function runScheduledAllocationReminders(): Promise<{
  upcoming: number
  sshT5: number
  sshT0: number
}> {
  const now = DateTime.utc()
  const t10 = labConfig.notifications.upcomingMinutes
  const t5 = labConfig.notifications.sshKeyReminderMinutes

  const upcomingRows = await Allocation.query()
    .where('status', 'approved')
    .where('userHidden', false)
    .where('startTime', '>', now.toSQL()!)
    .where('startTime', '<=', now.plus({ minutes: t10 }).toSQL()!)
    .preload('machine')

  let upcoming = 0
  for (const allocation of upcomingRows) {
    if (await alreadyNotified(allocation.userId, TITLE_UPCOMING, allocation.id)) continue

    const startLocal = allocation.startTime.setZone(labConfig.timezone).toFormat('dd/MM/yyyy HH:mm')
    const machineName = allocation.machine?.name ?? `Máquina #${allocation.machineId}`
    await notifyUser(
      allocation.userId,
      TITLE_UPCOMING,
      `${allocRef(allocation.id)} Sua reserva em ${machineName} começa às ${startLocal} (em até ${t10} minutos).`
    )
    upcoming++
  }

  const sshT5Rows = await Allocation.query()
    .where('status', 'approved')
    .where('userHidden', false)
    .where('startTime', '>', now.toSQL()!)
    .where('startTime', '<=', now.plus({ minutes: t5 }).toSQL()!)
    .preload('machine')

  let sshT5 = 0
  for (const allocation of sshT5Rows) {
    const machine = allocation.machine
    if (!machine) continue
    if (await notifyMissingSshKeyForAllocation(allocation, machine, TITLE_SSH_T5, 'Faltam até 5 minutos.')) {
      sshT5++
    }
  }

  const sshT0Rows = await Allocation.query()
    .where('status', 'approved')
    .where('userHidden', false)
    .where('startTime', '<=', now.toSQL()!)
    .where('endTime', '>=', now.toSQL()!)
    .preload('machine')

  let sshT0 = 0
  for (const allocation of sshT0Rows) {
    const machine = allocation.machine
    if (!machine) continue
    if (
      await notifyMissingSshKeyForAllocation(
        allocation,
        machine,
        TITLE_SSH_T0,
        'A sessão já começou.'
      )
    ) {
      sshT0++
    }
  }

  return { upcoming, sshT5, sshT0 }
}

/** Heartbeat: revalida chave SSH no início da sessão (T-0). */
export async function maybeNotifyMissingSshKeyAtSessionStart(
  allocation: AllocationModel,
  machine: MachineModel
): Promise<void> {
  await notifyMissingSshKeyForAllocation(
    allocation,
    machine,
    TITLE_SSH_T0,
    'A sessão já começou.'
  )
}

/**
 * Heartbeat: alerta admin se houver muitas falhas SSH recentes.
 * Só roda quando o agente envia sshAttempts no heartbeat (não na telemetria).
 */
export async function checkSshFailureFlood(machine: MachineModel): Promise<void> {
  const { windowMinutes, threshold, cooldownHours } = labConfig.notifications.sshFailureFlood
  const since = DateTime.utc().minus({ minutes: windowMinutes })

  const countRow = await SshConnectionAttempt.query()
    .where('machineId', machine.id)
    .where('status', 'failed')
    .where('createdAt', '>=', since.toSQL()!)
    .count('* as total')

  const failedCount = Number(countRow[0].$extras.total)
  if (failedCount < threshold) return

  const title = 'Possível flood SSH'
  if (await alreadyNotifiedAdminsForMachine(title, machine.id, cooldownHours)) return

  await notifyAllAdmins(
    title,
    `${machineRef(machine.id)} ${failedCount} falhas SSH em ${machine.name} nos últimos ${windowMinutes} minutos. Verifique Auditoria SSH.`
  )
}

/**
 * Scheduler: máquinas sem heartbeat recente (available/occupied).
 * Cooldown longo (padrão 24 h) — lembrete periódico para manutenção ou retirada do parque, não flood.
 */
export async function notifyOfflineAgents(): Promise<number> {
  const { offlineMinutes, cooldownHours } = labConfig.notifications.agentOffline
  const cutoff = DateTime.utc().minus({ minutes: offlineMinutes })

  const machines = await Machine.query()
    .whereIn('status', ['available', 'occupied'])
    .where((q) => {
      q.whereNull('lastSeenAt').orWhere('lastSeenAt', '<', cutoff.toSQL()!)
    })

  const title = 'Agente offline'
  let sent = 0

  for (const machine of machines) {
    if (await alreadyNotifiedAdminsForMachine(title, machine.id, cooldownHours)) continue

    const lastSeen = machine.lastSeenAt
      ? machine.lastSeenAt.setZone(labConfig.timezone).toFormat('dd/MM/yyyy HH:mm')
      : 'nunca'

    await notifyAllAdmins(
      title,
      `${machineRef(machine.id)} ${machine.name} sem heartbeat desde ${lastSeen} (limite: ${offlineMinutes} min). Avalie colocar em manutenção ou retirar do parque.`
    )
    sent++
  }

  return sent
}

/** Encaminha mudança de status conforme política do lab. */
export async function notifyAllocationStatusChange(
  allocation: AllocationModel,
  machine: MachineModel,
  previousStatus: AllocationModel['status']
) {
  if (allocation.status === previousStatus) return

  if (allocation.status === 'approved') {
    await notifyAllocationApprovedFromPending(allocation, machine, previousStatus)
    return
  }

  if (allocation.status === 'denied') {
    await notifyAllocationDenied(allocation, machine)
    await notifyAdminsSudoAllocationOutcome(allocation, machine, previousStatus)
    return
  }

  if (allocation.status === 'cancelled') {
    await notifyAllocationCancelled(allocation, machine)
    await notifyAdminsSudoAllocationOutcome(allocation, machine, previousStatus)
  }
}

/** Cancela reservas ativas/pendentes e notifica usuários (manutenção). */
export async function cancelAllocationsForMaintenance(machine: MachineModel): Promise<number> {
  const allocations = await Allocation.query()
    .where('machineId', machine.id)
    .whereIn('status', ['approved', 'pending'])

  let count = 0
  for (const allocation of allocations) {
    allocation.status = 'cancelled'
    await allocation.save()
    await notifyAllocationCancelledDueToMaintenance(allocation, machine)
    count++
  }

  return count
}
