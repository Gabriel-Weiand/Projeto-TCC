/**
 * Horários — ver apps/web/docs/TIMEZONE.md
 *
 * API/banco: UTC. Formulários: parede no fuso do lab. UI: formatLab* no fuso do lab.
 */
export const DEFAULT_LAB_TZ = "America/Sao_Paulo";

function labPartsFormatter(timeZone: string, includeSeconds = false) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  });
}

function partsInZone(iso: string, timeZone: string) {
  const d = new Date(normalizeApiUtcIso(iso));
  if (Number.isNaN(d.getTime())) {
    throw new Error("ISO inválido.");
  }
  const parts = labPartsFormatter(timeZone).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Offset (ms) entre o instante UTC e os componentes de parede no fuso do lab. */
function timezoneOffsetMs(utcMs: number, timeZone: string): number {
  const d = new Date(utcMs);
  const parts = labPartsFormatter(timeZone, true).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}

/** Garante parsing como UTC quando a API omite Z. */
export function normalizeApiUtcIso(iso: string): string {
  if (!iso) return iso;
  const s = iso.trim().replace(" ", "T");
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s}Z`;
}

export function parseApiUtcMs(iso: string): number {
  return new Date(normalizeApiUtcIso(iso)).getTime();
}

/** date (YYYY-MM-DD) + time (HH:mm) no fuso do lab → ISO UTC. */
export function wallClockToUtcIso(
  date: string,
  time: string,
  timeZone: string = DEFAULT_LAB_TZ,
): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (
    [y, m, d, hh, mm].some((n) => Number.isNaN(n)) ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31 ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    throw new Error("Data ou horário inválido.");
  }

  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  let utcMs = wallAsUtc;
  for (let i = 0; i < 4; i++) {
    const offset = timezoneOffsetMs(utcMs, timeZone);
    utcMs = wallAsUtc - offset;
  }
  return new Date(utcMs).toISOString();
}

export function formatLabDateTime(
  iso: string,
  timeZone: string = DEFAULT_LAB_TZ,
): string {
  const p = partsInZone(iso, timeZone);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export function formatLabDate(iso: string, timeZone: string = DEFAULT_LAB_TZ): string {
  const p = partsInZone(iso, timeZone);
  return `${p.day}/${p.month}/${p.year}`;
}

/** ISO UTC → campos para `<input type="date">` e `<input type="time">` no fuso do lab. */
export function utcIsoToWallClockFields(
  iso: string,
  timeZone: string = DEFAULT_LAB_TZ,
): { date: string; time: string } {
  const p = partsInZone(iso, timeZone);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
  };
}

export function formatLabTime(iso: string, timeZone: string = DEFAULT_LAB_TZ): string {
  const p = partsInZone(iso, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** Duração curta para tooltip (ex.: 1h30, 45 min). */
export function formatDurationShort(durationMs: number): string {
  const totalMin = Math.max(1, Math.round(durationMs / 60_000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** Intervalo para tooltip/listas (sempre com horário de início e fim no fuso do lab). */
export function formatLabAllocationRange(
  startIso: string,
  endIso: string,
  timeZone: string = DEFAULT_LAB_TZ,
): string {
  const startDate = utcIsoToWallClockFields(startIso, timeZone).date;
  const endDate = utcIsoToWallClockFields(endIso, timeZone).date;
  const startLabel = `${formatLabDate(startIso, timeZone)} ${formatLabTime(startIso, timeZone)}`;
  const endLabel = `${formatLabDate(endIso, timeZone)} ${formatLabTime(endIso, timeZone)}`;
  const durationMs = parseApiUtcMs(endIso) - parseApiUtcMs(startIso);

  if (startDate !== endDate) {
    if (durationMs < 86_400_000) {
      return `${startLabel} → ${endLabel} (${formatDurationShort(durationMs)})`;
    }
    const days = Math.max(1, Math.ceil(durationMs / 86_400_000));
    return `${startLabel} → ${endLabel} (${days}d)`;
  }
  return `${formatLabDate(startIso, timeZone)} ${formatLabTime(startIso, timeZone)} – ${formatLabTime(endIso, timeZone)}`;
}

export function isNowInUtcRange(startIso: string, endIso: string, nowMs = Date.now()): boolean {
  const s = parseApiUtcMs(startIso);
  const e = parseApiUtcMs(endIso);
  return nowMs >= s && nowMs < e;
}

export function isNowBeforeUtc(iso: string, nowMs = Date.now()): boolean {
  return nowMs < parseApiUtcMs(iso);
}

/** Até `graceMinutes` após o fim (extensão). */
export function isNowWithinGraceAfterEnd(
  endIso: string,
  graceMinutes: number,
  nowMs = Date.now(),
): boolean {
  return nowMs <= parseApiUtcMs(endIso) + graceMinutes * 60_000;
}
