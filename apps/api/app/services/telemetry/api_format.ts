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

function scaledWire(v: unknown): number | null {
  return typeof v === 'number' ? v / 10 : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

export function normalizeProcessSummaryEntry(raw: Record<string, unknown>) {
  const optionalScaled = (key: string) =>
    raw[key] !== undefined ? scaledWire(raw[key]) : undefined
  const optionalNumber = (key: string) =>
    raw[key] !== undefined ? asNumber(raw[key]) : undefined

  return {
    pid: asNumber(raw.pid),
    name: raw.name ? String(raw.name) : null,
    username: raw.username ? String(raw.username) : null,
    sampleCount: asNumber(raw.sampleCount),
    avgCpuPercent: scaledWire(raw.avgCpuPercent),
    maxCpuPercent: scaledWire(raw.maxCpuPercent),
    avgRamMb: optionalNumber('avgRamMb'),
    maxRamMb: optionalNumber('maxRamMb'),
    avgVramMb: optionalNumber('avgVramMb'),
    maxVramMb: optionalNumber('maxVramMb'),
    avgGpuUse: optionalScaled('avgGpuUse'),
    maxGpuUse: optionalScaled('maxGpuUse'),
    avgDiskReadKbps: optionalNumber('avgDiskReadKbps'),
    maxDiskReadKbps: optionalNumber('maxDiskReadKbps'),
    avgDiskWriteKbps: optionalNumber('avgDiskWriteKbps'),
    maxDiskWriteKbps: optionalNumber('maxDiskWriteKbps'),
  }
}

export function normalizeProcessSummary(
  summary: Record<string, unknown>[] | null | undefined
) {
  if (!summary || !Array.isArray(summary)) return []
  return summary.map((entry) => normalizeProcessSummaryEntry(entry))
}

/** Serializa AllocationMetric incluindo chartSeries normalizado. */
export function serializeAllocationMetric(metric: {
  serialize: () => Record<string, unknown>
  chartSeries?: Record<string, unknown>[] | null
  processSummary?: Record<string, unknown>[] | null
}) {
  const base = metric.serialize()
  return {
    ...base,
    chartSeries: normalizeChartSeries(metric.chartSeries ?? null),
    processSummary: normalizeProcessSummary(metric.processSummary ?? null),
  }
}
