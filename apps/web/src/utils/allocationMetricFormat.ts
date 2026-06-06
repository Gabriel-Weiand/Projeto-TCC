/** Valores wire (×10) da API → exibição legível. */
export function metricUsagePct(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return v / 10;
}

export function metricTempC(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return v / 10;
}

export function metricGb(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return v / 10;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(digits)}%`;
}

export function fmtTemp(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(0)}°C`;
}

export function fmtGb(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)} GB`;
}

export function fmtMbps(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(1)} Mbps`;
}

export function fmtWatts(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v)} W`;
}

export function formatDurationMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

export const fmtDurationMinutes = formatDurationMinutes;

/** Duração representada por cada ponto do gráfico resumido. */
export function formatBucketDuration(bucketMinutes: number): string {
  if (bucketMinutes >= 60) {
    const h = Math.floor(bucketMinutes / 60);
    const m = bucketMinutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
  return `${bucketMinutes} min`;
}

export function formatChartResolutionLegend(
  pointCount: number,
  bucketMinutes?: number | null,
): string {
  if (bucketMinutes == null || bucketMinutes <= 0) {
    return `${pointCount} pontos`;
  }
  return `${pointCount} pontos · ~${formatBucketDuration(bucketMinutes)}/ponto`;
}

export function usageOverTotalPct(
  used: number | null | undefined,
  total: number | null | undefined,
): number | null {
  if (used == null || total == null || total <= 0) return null;
  return (used / total) * 100;
}
