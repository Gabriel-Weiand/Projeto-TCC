/** Escala wire (×10) para exibição; null/undefined permanecem ausentes. */
function scaledWire(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || Number.isNaN(v)) return null
  return v / 10
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || Number.isNaN(v)) return null
  return v
}

function agentGbToApi(wire: unknown): number | null {
  if (wire === null || wire === undefined) return null
  if (typeof wire !== 'number' || Number.isNaN(wire)) return null
  return wire / 10
}

function normalizeProcessSnapshot(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const pid = asNumber(p.pid)
  const name = typeof p.name === 'string' ? p.name : null
  const username = typeof p.username === 'string' ? p.username : null
  if (pid == null || !name || !username) return null

  return {
    pid,
    name,
    username,
    cpuPercent: scaledWire(p.cpuPercent),
    ramMb: asNumber(p.ramMb),
    vramMb: asNumber(p.vramMb),
    gpuUse: scaledWire(p.gpuUse),
    diskReadKbps: asNumber(p.diskReadKbps),
    diskWriteKbps: asNumber(p.diskWriteKbps),
  }
}

function normalizeProcesses(raw: unknown) {
  if (!Array.isArray(raw)) return null
  const out = raw.map(normalizeProcessSnapshot).filter((p): p is NonNullable<typeof p> => p != null)
  return out.length > 0 ? out : null
}

/**
 * Normaliza telemetria bruta do agente/buffer para resposta HTTP.
 * null = métrica não coletada; 0 = valor real zero.
 */
export function normalizeRealtimeTelemetry(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const disksRaw = r.disksInfo ?? r.disks ?? null

  return {
    cpuUsage: scaledWire(r.cpuUsage),
    cpuTemp: scaledWire(r.cpuTemp),
    cpuFreqMhz: asNumber(r.cpuFreqMhz),

    gpuUsage: scaledWire(r.gpuUsage),
    gpuTemp: scaledWire(r.gpuTemp),
    gpuPowerWatts: asNumber(r.gpuPowerWatts),

    ramTotalGb: agentGbToApi(r.ramTotalGb),
    ramUsedGb: agentGbToApi(r.ramUsedGb),
    swapTotalGb: agentGbToApi(r.swapTotalGb),
    swapUsedGb: agentGbToApi(r.swapUsedGb),
    vramTotalGb: agentGbToApi(r.vramTotalGb),
    vramUsedGb: agentGbToApi(r.vramUsedGb),

    disksInfo: disksRaw,
    diskReadMbps: asNumber(r.diskReadMbps),
    diskWriteMbps: asNumber(r.diskWriteMbps),
    downloadMbps: asNumber(r.downloadMbps),
    uploadMbps: asNumber(r.uploadMbps),

    moboTemperature: scaledWire(r.moboTemperature),
    activeUsers: r.activeUsers ?? null,
    processes: normalizeProcesses(r.processes),

    timestamp: r.timestamp ? String(r.timestamp) : new Date().toISOString(),
  }
}
