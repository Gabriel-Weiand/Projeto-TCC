/** Normaliza ponto de série temporal (wire ×10) para resposta HTTP ao frontend. */
export function normalizeChartSeriesPoint(raw: Record<string, unknown>) {
  const scaled = (v: unknown) => (typeof v === 'number' ? v / 10 : null)
  const asNumber = (v: unknown) => (typeof v === 'number' ? v : null)

  return {
    timestamp: raw.timestamp ? String(raw.timestamp) : null,
    cpuUsage: scaled(raw.cpuUsage),
    cpuTemp: scaled(raw.cpuTemp),
    cpuFreqMhz: asNumber(raw.cpuFreqMhz),
    gpuUsage: raw.gpuUsage !== undefined ? scaled(raw.gpuUsage) : null,
    gpuTemp: raw.gpuTemp !== undefined ? scaled(raw.gpuTemp) : null,
    gpuPowerWatts: asNumber(raw.gpuPowerWatts),
    ramTotalGb: scaled(raw.ramTotalGb),
    ramUsedGb: scaled(raw.ramUsedGb),
    swapTotalGb: scaled(raw.swapTotalGb),
    swapUsedGb: scaled(raw.swapUsedGb),
    vramTotalGb: scaled(raw.vramTotalGb),
    vramUsedGb: scaled(raw.vramUsedGb),
    diskReadMbps: asNumber(raw.diskReadMbps),
    diskWriteMbps: asNumber(raw.diskWriteMbps),
    downloadMbps: asNumber(raw.downloadMbps),
    uploadMbps: asNumber(raw.uploadMbps),
    moboTemperature: raw.moboTemperature !== undefined ? scaled(raw.moboTemperature) : null,
  }
}

export function normalizeChartSeries(
  series: Record<string, unknown>[] | null | undefined
): ReturnType<typeof normalizeChartSeriesPoint>[] {
  if (!series || !Array.isArray(series)) return []
  return series.map((point) => normalizeChartSeriesPoint(point))
}

/** Serializa AllocationMetric incluindo chartSeries normalizado. */
export function serializeAllocationMetric(metric: {
  serialize: () => Record<string, unknown>
  chartSeries?: Record<string, unknown>[] | null
}) {
  const base = metric.serialize()
  return {
    ...base,
    chartSeries: normalizeChartSeries(metric.chartSeries ?? null),
  }
}
