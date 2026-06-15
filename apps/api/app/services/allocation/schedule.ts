import { DateTime } from 'luxon'
import {
  assertAllocationEndWithinLimit,
  assertAllocationMinDuration,
} from '#services/lab/config'

export type ScheduleValidationError = {
  code: string
  message: string
}

export type ValidateAllocationScheduleOptions = {
  /** Permite início no passado (extensão ou PATCH sem alterar o início). */
  allowPastStart?: boolean
  now?: DateTime
}

/** Valida intervalo de reserva (início/fim, passado, limite futuro, duração mínima). */
export function validateAllocationSchedule(
  startTime: DateTime,
  endTime: DateTime,
  options?: ValidateAllocationScheduleOptions
): ScheduleValidationError | null {
  const now = options?.now ?? DateTime.utc()
  /** Tolerância para submissão de formulário / relógios levemente dessincronizados. */
  const startPastCutoff = now.minus({ seconds: 59 })

  if (!options?.allowPastStart && startTime < startPastCutoff) {
    return {
      code: 'ALLOCATION_IN_PAST',
      message: 'O horário de início não pode estar no passado.',
    }
  }

  if (endTime.toMillis() <= now.toMillis()) {
    return {
      code: 'ALLOCATION_IN_PAST',
      message: 'O horário de término não pode estar no passado.',
    }
  }

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
