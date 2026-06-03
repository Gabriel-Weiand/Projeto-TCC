/** Tamanho máximo de um lote de telemetria (agente + API). */
export const TELEMETRY_STREAM_BATCH_MAX = 15;

export type TelemetryTimestamped = { timestamp: string };

export function sortTelemetryByTimestamp<T extends TelemetryTimestamped>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

/**
 * Retorna amostras do lote `next` que não existiam no lote `previous` (por timestamp).
 * Ex.: previous [1..15], next [5..19] → apenas [16..19].
 */
export function diffTelemetryBatches<T extends TelemetryTimestamped>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  if (!next.length) return [];
  if (!previous.length) return sortTelemetryByTimestamp(next);

  const previousTimestamps = new Set(previous.map((e) => e.timestamp));
  return sortTelemetryByTimestamp(next).filter(
    (e) => !previousTimestamps.has(e.timestamp),
  );
}

export function telemetryTimestampMs(timestamp: string): number {
  const ms = new Date(timestamp).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Evita alternar stream (poll) com snapshot da máquina mais antigo. */
export function pickNewerTelemetry<T extends TelemetryTimestamped>(
  primary: T | null | undefined,
  fallback: T | null | undefined,
): T | null {
  if (!primary) return fallback ?? null;
  if (!fallback) return primary;
  return telemetryTimestampMs(primary.timestamp) >= telemetryTimestampMs(fallback.timestamp)
    ? primary
    : fallback;
}

/**
 * Calcula atrasos em ms entre amostras consecutivas (intervalo real da coleta no agente).
 * Fallback de 1s quando timestamps iguais ou inválidos.
 */
export function telemetryStepDelaysMs(
  entries: readonly TelemetryTimestamped[],
  maxStepMs = 60_000,
): number[] {
  const sorted = sortTelemetryByTimestamp(entries);
  if (sorted.length <= 1) return sorted.length ? [0] : [];

  const delays: number[] = [0];
  for (let i = 1; i < sorted.length; i++) {
    const prev = telemetryTimestampMs(sorted[i - 1]!.timestamp);
    const cur = telemetryTimestampMs(sorted[i]!.timestamp);
    let step = cur - prev;
    if (!Number.isFinite(step) || step <= 0) step = 1000;
    delays.push(Math.min(step, maxStepMs));
  }
  return delays;
}
