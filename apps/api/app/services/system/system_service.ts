import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import Notification from '#models/notification'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import { labConfig } from '#services/lab/config'
import {
  pruneNotifications,
  pruneSshAttempts,
  runLabMaintenance,
} from '#services/lab/maintenance'

export type PruneNotificationsInput = {
  before?: Date
  userId?: number
}

export type PruneSshAttemptsInput = {
  keepDays?: number
  machineId?: number
}

export const SystemService = {
  async runMaintenance() {
    const result = await runLabMaintenance()
    return {
      message: 'Manutenção executada com sucesso.',
      ...result,
    }
  },

  async pruneNotifications(input: PruneNotificationsInput) {
    const before = input.before ? DateTime.fromJSDate(input.before) : undefined

    const deleted = await pruneNotifications({
      before,
      userId: input.userId,
    })

    return {
      message: 'Notificações removidas com sucesso.',
      deleted,
    }
  },

  async pruneSshAttempts(input: PruneSshAttemptsInput) {
    const deleted = await pruneSshAttempts({
      keepDays: input.keepDays,
      machineId: input.machineId,
    })

    return {
      message: 'Tentativas SSH removidas com sucesso.',
      deleted,
      keepDays: input.keepDays ?? labConfig.maintenance.pruneSshAttemptsDays,
    }
  },

  async hardDeleteAllocation(allocationId: number) {
    const allocation = await Allocation.findOrFail(allocationId)
    await allocation.delete()
  },

  async hardDeleteNotification(notificationId: number) {
    const notification = await Notification.findOrFail(notificationId)
    await notification.delete()
  },

  async hardDeleteSshAttempt(attemptId: number) {
    const attempt = await SshConnectionAttempt.findOrFail(attemptId)
    await attempt.delete()
  },
}
