import { DateTime } from 'luxon'

/**
 * Converte ISO (com Z, +00:00 ou offset local) para DateTime UTC.
 * Strings sem offset são tratadas como UTC (front deve enviar Z).
 */
export function parseUtcFromIso(value: string): DateTime {
  let dt = DateTime.fromISO(value, { setZone: true })
  if (!dt.isValid) {
    const normalized = value.trim().replace(' ', 'T')
    const withZ = /[Zz]$/.test(normalized) || /[+-]\d{2}/.test(normalized) ? normalized : `${normalized}Z`
    dt = DateTime.fromISO(withZ, { zone: 'utc' })
  }
  if (!dt.isValid) {
    throw new Error(`Data/hora inválida: ${value}`)
  }
  return dt.toUTC()
}

/** Grava no SQLite sempre como relógio UTC (sem aplicar TZ do processo). */
export function dateTimeToSqlUtc(value: DateTime): string {
  return value.toUTC().toFormat('yyyy-MM-dd HH:mm:ss')
}

/** Lê do SQLite como instante UTC. */
export function dateTimeFromSqlUtc(value: string): DateTime {
  return DateTime.fromSQL(value, { zone: 'utc' })
}
