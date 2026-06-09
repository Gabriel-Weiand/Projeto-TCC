import { normalizeApiUtcIso, parseApiUtcMs, wallClockToUtcIso } from "@/utils/datetime";

function addCalendarDays(isoDate: string, days: number): string {
  const [yRaw, mRaw, dRaw] = isoDate.split("-").map(Number);
  const y = yRaw ?? NaN;
  const m = mRaw ?? NaN;
  const d = dRaw ?? NaN;
  if ([y, m, d].some((n) => Number.isNaN(n))) {
    throw new Error("Data inválida.");
  }
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Fim do último dia permitido (hoje + maxFutureDays, 23:59 no fuso do lab) em ISO UTC. */
export function labMaxEndUtcIso(
  timezone: string,
  maxFutureDays: number,
  todayLocalDate: string,
): string {
  const lastDay = addCalendarDays(todayLocalDate, maxFutureDays);
  return wallClockToUtcIso(lastDay, "23:59", timezone);
}

export function isAllocationEndBeyondLabLimit(
  endDate: string,
  endTime: string,
  timezone: string,
  maxFutureDays: number,
  todayLocalDate: string,
): boolean {
  const endIso = wallClockToUtcIso(endDate, endTime, timezone);
  const maxIso = labMaxEndUtcIso(timezone, maxFutureDays, todayLocalDate);
  return endIso > maxIso;
}

export type ReservationPeriodFields = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

export function isPeriodRangeOrderInvalid(
  fields: ReservationPeriodFields,
  timezone: string,
): boolean {
  try {
    const start = wallClockToUtcIso(
      fields.startDate,
      fields.startTime,
      timezone,
    );
    const end = wallClockToUtcIso(fields.endDate, fields.endTime, timezone);
    return end <= start;
  } catch {
    return true;
  }
}

/** Início mais de ~1 min no passado (alinhado à tolerância da API). */
export function isPeriodStartInPast(
  startDate: string,
  startTime: string,
  timezone: string,
  nowMs: number,
): boolean {
  try {
    const startMs = parseApiUtcMs(
      wallClockToUtcIso(startDate, startTime, timezone),
    );
    return startMs < nowMs - 59_000;
  } catch {
    return false;
  }
}

/** Fim no passado ou igual a agora (UTC ms do servidor). */
export function isPeriodEndInPast(
  endDate: string,
  endTime: string,
  timezone: string,
  nowMs: number,
): boolean {
  try {
    const endMs = parseApiUtcMs(
      wallClockToUtcIso(endDate, endTime, timezone),
    );
    return endMs <= nowMs;
  } catch {
    return false;
  }
}

/** Início ou fim no passado. */
export function isPeriodInPast(
  fields: ReservationPeriodFields,
  timezone: string,
  nowMs: number,
): boolean {
  return (
    isPeriodStartInPast(
      fields.startDate,
      fields.startTime,
      timezone,
      nowMs,
    ) ||
    isPeriodEndInPast(fields.endDate, fields.endTime, timezone, nowMs)
  );
}

/** Duração em minutos menor que o mínimo do laboratório (API: ALLOCATION_TOO_SHORT). */
function extendEndCompareMs(
  endDate: string,
  endTime: string,
  timezone: string,
  currentEndIso: string,
): number | null {
  try {
    const endIso = normalizeApiUtcIso(
      wallClockToUtcIso(endDate, endTime, timezone),
    );
    return parseApiUtcMs(endIso) - parseApiUtcMs(currentEndIso);
  } catch {
    return null;
  }
}

/** Extensão (envio): novo fim não é estritamente posterior ao fim atual (igual = sem extensão). */
export function isExtendEndNotAfterCurrent(
  endDate: string,
  endTime: string,
  timezone: string,
  currentEndIso: string,
): boolean {
  const delta = extendEndCompareMs(endDate, endTime, timezone, currentEndIso);
  return delta === null || delta <= 0;
}

/** Extensão (borda vermelha): novo fim anterior ao fim atual — igual ao atual não é erro visual. */
export function isExtendEndBeforeCurrent(
  endDate: string,
  endTime: string,
  timezone: string,
  currentEndIso: string,
): boolean {
  const delta = extendEndCompareMs(endDate, endTime, timezone, currentEndIso);
  return delta === null || delta < 0;
}

export function isPeriodDurationTooShort(
  fields: ReservationPeriodFields,
  timezone: string,
  minDurationMinutes: number,
): boolean {
  if (isPeriodRangeOrderInvalid(fields, timezone)) return false;
  try {
    const startMs = new Date(
      wallClockToUtcIso(fields.startDate, fields.startTime, timezone),
    ).getTime();
    const endMs = new Date(
      wallClockToUtcIso(fields.endDate, fields.endTime, timezone),
    ).getTime();
    const minutes = (endMs - startMs) / 60_000;
    return minutes < minDurationMinutes;
  } catch {
    return false;
  }
}
