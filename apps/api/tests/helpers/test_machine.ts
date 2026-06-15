import Machine from '#models/machine'
import { DateTime } from 'luxon'

type MachineCreateInput = Partial<{
  name: string
  description: string
  status: Machine['status']
  lastSeenAt: DateTime | null
}> &
  Record<string, unknown>

/**
 * Máquina “online” para testes de reserva/alocação.
 * Sem lastSeenAt recente o status efetivo fica offline e POST /allocations retorna 400.
 */
export async function createTestMachine(overrides: MachineCreateInput = {}) {
  const { lastSeenAt, ...rest } = overrides

  return Machine.create({
    description: 'Lab',
    status: 'available',
    lastSeenAt: lastSeenAt !== undefined ? lastSeenAt : DateTime.utc(),
    ...rest,
  })
}
