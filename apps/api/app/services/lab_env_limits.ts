/**
 * Limites documentados para variáveis LAB_* (valores fora da faixa caem no default ou são clampados).
 * Referência: MODULE.md — seção "Limites de variáveis de ambiente".
 */
export const LAB_ENV_LIMITS = {
  calendar: {
    pastDays: { min: 1, max: 3650 },
    futureDaysOption: { min: 1, max: 3650 },
    futureDaysOptionsMaxItems: 20,
    defaultFutureDays: { min: 1, max: 3650 },
  },
  allocation: {
    maxFutureDays: { min: 1, max: 3650 },
    minDurationMinutes: { min: 1, max: 1440 },
    scheduleHour: { min: 0, max: 24 },
    graceMinutes: { min: 0, max: 1440 },
    postSftpMinutes: { min: 0, max: 10080 },
    deleteUserDays: { min: 0, max: 365 },
    prepareMinutes: { min: 0, max: 1440 },
  },
  maintenance: {
    summarizeAfterHours: { min: 1, max: 8760 },
    pruneDays: { min: 1, max: 3650 },
  },
  notifications: {
    upcomingMinutes: { min: 1, max: 1440 },
    sshKeyMinutes: { min: 1, max: 1440 },
    sshFloodWindowMinutes: { min: 1, max: 1440 },
    sshFloodThreshold: { min: 1, max: 10_000 },
    sshFloodCooldownHours: { min: 1, max: 168 },
    agentOfflineMinutes: { min: 1, max: 1440 },
    agentOfflineCooldownHours: { min: 1, max: 168 },
  },
} as const
