import SshConnectionAttempt from '#models/ssh_connection_attempt'

export type ListSshAttemptsFilters = {
  machineId?: number
  page?: number
  limit?: number
}

export const SshAttemptsService = {
  async listAttempts(filters: ListSshAttemptsFilters) {
    const { machineId, page = 1, limit = 50 } = filters

    let query = SshConnectionAttempt.query().preload('machine').orderBy('createdAt', 'desc')

    if (machineId) {
      query = query.where('machineId', machineId)
    }

    return query.paginate(page, limit)
  },
}
