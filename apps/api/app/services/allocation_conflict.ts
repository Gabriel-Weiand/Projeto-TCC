import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import { getLabAccessConfig } from '#services/lab_config'

/** Fim do bloqueio de calendário: `endTime` + grace (reservas `approved`). */
function calendarBlockEnd(allocation: Allocation, graceMinutes: number): DateTime {
  if (allocation.status === 'approved') {
    return allocation.endTime.plus({ minutes: graceMinutes })
  }
  return allocation.endTime
}

/**
 * Verifica conflito de horário na mesma máquina.
 * Janela da reserva existente `approved`: [startTime, endTime + grace].
 * A nova reserva não pode começar antes de `endTime + grace` da existente.
 */
export async function findAllocationConflict(
  machineId: number,
  startTime: DateTime,
  endTime: DateTime,
  excludeId?: number
): Promise<Allocation | null> {
  const { graceMinutes } = getLabAccessConfig()

  let query = Allocation.query()
    .where('machineId', machineId)
    .whereIn('status', ['approved', 'pending'])

  if (excludeId !== undefined) {
    query = query.whereNot('id', excludeId)
  }

  const candidates = await query

  for (const existing of candidates) {
    const blockEnd = calendarBlockEnd(existing, graceMinutes)

    if (startTime < blockEnd && endTime.plus({ minutes: graceMinutes }) > existing.startTime) {
      return existing
    }
  }

  return null
}
