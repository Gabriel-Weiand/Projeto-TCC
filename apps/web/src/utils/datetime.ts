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
  const [yRaw, mRaw, dRaw] = date.split("-").map(Number);
  const [hhRaw, mmRaw] = time.split(":").map(Number);
  const y = yRaw ?? NaN;
  const m = mRaw ?? NaN;
  const d = dRaw ?? NaN;
  const hh = hhRaw ?? NaN;
  const mm = mmRaw ?? NaN;
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

/** YYYY-MM-DD → DD/MM/YYYY (exibição em formulários). */
export function isoDateToBr(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

/** DD/MM/YYYY → YYYY-MM-DD ou null se inválido. */
export function brDateToIso(br: string): string | null {
  const match = br.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000) {
    return null;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Formata digitação parcial como DD/MM/AAAA. */
export function formatBrDateTyping(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** HH:mm (24h) ou null se inválido. */
export function normalizeWallClockTime(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Separa HH:mm em partes de hora e minuto (sem zero-fill). */
export function splitWallClockTime(raw: string): { hour: string; minute: string } {
  const trimmed = raw.trim();
  if (!trimmed.includes(":")) {
    return { hour: trimmed.replace(/\D/g, ""), minute: "" };
  }
  const [hour = "", minute = ""] = trimmed.split(":");
  return {
    hour: hour.replace(/\D/g, "").slice(0, 2),
    minute: minute.replace(/\D/g, "").slice(0, 2),
  };
}

/** Mantém só dígitos (máx. 2) para campo de hora ou minuto. */
export function formatWallClockPartTyping(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 2);
}

/** Hora parcial/completa válida no relógio 24h (00–23). Vazio = ok durante digitação. */
export function isWallClockHourValid(hour: string): boolean {
  if (!hour) return true;
  if (!/^\d{1,2}$/.test(hour)) return false;
  const h = Number(hour);
  return h >= 0 && h <= 23;
}

/** Minuto parcial/completo válido (00–59). Vazio = ok durante digitação. */
export function isWallClockMinuteValid(minute: string): boolean {
  if (!minute) return true;
  if (!/^\d{1,2}$/.test(minute)) return false;
  const m = Number(minute);
  return m >= 0 && m <= 59;
}

/** true quando hora e minuto formam HH:mm completo e válido. */
export function isWallClockTimeComplete(hour: string, minute: string): boolean {
  if (!hour || !minute) return false;
  return normalizeWallClockTime(`${hour}:${minute}`) !== null;
}

/** Normaliza partes soltas para HH:mm ou null. */
export function normalizeWallClockParts(
  hour: string,
  minute: string,
): string | null {
  if (!hour || !minute) return null;
  return normalizeWallClockTime(`${hour}:${minute}`);
}

/** ISO UTC → campos de parede no fuso do lab (YYYY-MM-DD + HH:mm). */
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

/** Entre `endTime` e `endTime + grace` — intervalo [end, graceEnd). */
export function isNowWithinGraceAfterEnd(
  endIso: string,
  graceMinutes: number,
  nowMs = Date.now(),
): boolean {
  if (graceMinutes <= 0) return false;
  const endMs = parseApiUtcMs(endIso);
  const graceEndMs = endMs + graceMinutes * 60_000;
  return nowMs >= endMs && nowMs < graceEndMs;
}

/** Entre fim do grace e fim da janela SFTP — intervalo [graceEnd, sftpEnd). */
export function isNowWithinSftpAfterGrace(
  endIso: string,
  graceMinutes: number,
  postSftpMinutes: number,
  nowMs = Date.now(),
): boolean {
  if (postSftpMinutes <= 0) return false;
  const endMs = parseApiUtcMs(endIso);
  const graceEndMs = endMs + graceMinutes * 60_000;
  const sftpEndMs = graceEndMs + postSftpMinutes * 60_000;
  return nowMs >= graceEndMs && nowMs < sftpEndMs;
}
