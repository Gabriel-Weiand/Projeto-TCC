import { DateTime } from 'luxon'
import { labConfig } from '#services/lab/config'

/** Instante futuro (UTC) para evitar `ALLOCATION_IN_PAST` em testes de alocação. */
export function futureUtc(hoursAhead = 2, minute = 0) {
  return DateTime.utc()
    .plus({ hours: hoursAhead })
    .set({ minute, second: 0, millisecond: 0 })
}

/** ISO UTC com sufixo Z (wire do front corrigido). */
export function toUtcIso(dt: DateTime) {
  return dt.toUTC().toISO()!
}

/** ISO com offset do fuso do laboratório (ex.: -03:00). */
export function toLabOffsetIso(dt: DateTime) {
  return dt.setZone(labConfig.timezone).toISO({ includeOffset: true, suppressMilliseconds: true })!
}

/** Data/hora sem offset — servidor trata como UTC (wire do front legado). */
export function toBareUtcWallClock(dt: DateTime) {
  return dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss")
}

/** Parede no fuso do lab sem offset (o que o front legado enviava). */
export function toBareLabWallClock(dt: DateTime) {
  return dt.setZone(labConfig.timezone).toFormat("yyyy-MM-dd'T'HH:mm:ss")
}
