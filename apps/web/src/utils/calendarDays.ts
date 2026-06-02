/** Partes numéricas de YYYY-MM-DD (validação mínima). */
function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`Invalid ISO date: ${iso}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** Soma dias a uma data ISO (YYYY-MM-DD) no calendário civil. */
export function addDaysToIsoDate(isoDate: string, delta: number): string {
  const { y, m, d } = parseIsoDate(isoDate)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return dt.toISOString().slice(0, 10)
}

export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Linha do tempo: de (hoje - pastDays) até (hoje + futureDays), inclusive. */
export function buildTimelineDays(
  todayIso: string,
  pastDays: number,
  futureDays: number,
): Date[] {
  const days: Date[] = []
  for (let i = -pastDays; i <= futureDays; i++) {
    const key = addDaysToIsoDate(todayIso, i)
    const { y, m, d } = parseIsoDate(key)
    days.push(new Date(y, m - 1, d))
  }
  return days
}

export function futureRangeLabel(days: number): string {
  if (days >= 365) return "1 ano"
  if (days >= 180) return "6 meses"
  if (days >= 90) return "3 meses"
  return `${days} dias`
}
