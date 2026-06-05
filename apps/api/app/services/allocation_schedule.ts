import type { DateTime } from 'luxon'
import {
  assertAllocationEndWithinLimit,
  assertAllocationMinDuration,
} from '#services/lab_config'

export type ScheduleValidationError = {
  code: string
  message: string
}

/** Valida intervalo de reserva (início/fim, limite futuro, duração mínima). */
export function validateAllocationSchedule(
  startTime: DateTime,
  endTime: DateTime
): ScheduleValidationError | null {
  if (endTime <= startTime) {
    return {
      code: 'INVALID_RANGE',
      message: 'O horário de término deve ser posterior ao de início.',
    }
  }

  const futureLimitMsg = assertAllocationEndWithinLimit(endTime)
  if (futureLimitMsg) {
    return { code: 'ALLOCATION_TOO_FAR', message: futureLimitMsg }
  }

  const minDurationMsg = assertAllocationMinDuration(startTime, endTime)
  if (minDurationMsg) {
    return { code: 'ALLOCATION_TOO_SHORT', message: minDurationMsg }
  }

  return null
}
