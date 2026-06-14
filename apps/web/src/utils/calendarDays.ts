/** Partes numéricas de YYYY-MM-DD (validação mínima). */
function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`Invalid ISO date: ${iso}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** Meia-noite local no calendário civil YYYY-MM-DD (sem parse de string ISO). */
function localDateFromIso(iso: string): Date {
  const { y, m, d } = parseIsoDate(iso)
  return new Date(y, m - 1, d)
}

export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Linha do tempo: de (hoje - pastDays) até (hoje + futureDays), inclusive. */
export function buildTimelineDays(
  todayIso: string,
  pastDays: number,
  futureDays: number,
): Date[] {
  const anchor = localDateFromIso(todayIso)
  const days: Date[] = []
  for (let i = -pastDays; i <= futureDays; i++) {
    const dt = new Date(anchor)
    dt.setDate(anchor.getDate() + i)
    days.push(dt)
  }
  return days
}

/** Dias civis entre duas datas ISO (to − from; pode ser negativo). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = localDateFromIso(fromIso)
  const to = localDateFromIso(toIso)
  const MS_PER_DAY = 86400000
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

export function futureRangeLabel(days: number): string {
  if (days >= 365) return '1 ano'
  if (days >= 180) return '6 meses'
  if (days >= 90) return '3 meses'
  return `${days} dias`
}
