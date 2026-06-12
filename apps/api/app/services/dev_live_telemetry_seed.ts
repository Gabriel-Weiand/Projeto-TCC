import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { idleTelemetryBuffer } from '#services/telemetry_idle_buffer'
import {
  generateRawTelemetriesWire,
  type UsageProfile,
} from '#services/seed_chart_series'
import logger from '@adonisjs/core/services/logger'

export type LiveTelemetrySeedEntry = {
  machineId: number
  allocationId: number
  hasGpu: boolean
  ramTotalGbWire: number
  vramTotalGbWire?: number | null
  profile: UsageProfile
  intervalSeconds: number
  sampleCount: number
  mode: 'active' | 'idle'
  includeProcessCapture?: boolean
  processTopX?: number
}

const SEED_FILE = 'storage/lab/live_telemetry_seed.json'

export function writeLiveTelemetrySeedFile(entries: LiveTelemetrySeedEntry[]): void {
  const path = app.makePath(SEED_FILE)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ entries }, null, 2), 'utf8')
}

/**
 * Popula buffers em memória após `migration:fresh --seed` (somente dev/local).
 * Ignorado em ambiente de teste.
 */
export function applyLiveTelemetrySeedIfPresent(): void {
  if (process.env.NODE_ENV === 'test') return

  const path = app.makePath(SEED_FILE)
  if (!existsSync(path)) return

  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: LiveTelemetrySeedEntry[]
    }

    const now = Date.now()

    for (const entry of payload.entries) {
      const endMs = now
      const startMs = now - entry.sampleCount * entry.intervalSeconds * 1000
      const rows = generateRawTelemetriesWire(
        entry.allocationId,
        startMs,
        endMs,
        entry.intervalSeconds * 1000,
        {
          profile: entry.profile,
          hasGpu: entry.hasGpu,
          ramTotalGbWire: entry.ramTotalGbWire,
          vramTotalGbWire: entry.vramTotalGbWire,
          includeProcessCapture: entry.includeProcessCapture !== false,
          processTopX: entry.processTopX ?? 10,
        }
      )

      if (rows.length === 0) continue

      const batch = rows.slice(-15).map((row) => ({
        allocationId: row.allocationId,
        timestamp: row.timestamp,
        cpuUsage: row.cpuUsage,
        cpuTemp: row.cpuTemp,
        gpuUsage: row.gpuUsage,
        gpuTemp: row.gpuTemp,
        gpuPowerWatts: row.gpuPowerWatts ?? null,
        vramTotalGb: row.vramTotalGb ?? null,
        vramUsedGb: row.vramUsedGb ?? null,
        ramTotalGb: row.ramTotalGb ?? null,
        ramUsedGb: row.ramUsedGb ?? null,
        swapTotalGb: row.swapTotalGb ?? null,
        swapUsedGb: row.swapUsedGb ?? null,
        diskReadMbps: row.diskReadMbps ?? null,
        diskWriteMbps: row.diskWriteMbps ?? null,
        moboTemperature: row.moboTemperature ?? null,
        activeUsers: null,
        disks: null,
        processes: row.processes ?? null,
      }))

      for (const sample of batch) {
        telemetryBuffer.updateRealtime(entry.machineId, sample)
        if (entry.mode === 'idle') {
          idleTelemetryBuffer.ingest(entry.machineId, sample, entry.intervalSeconds)
        }
      }

      telemetryBuffer.recordBatch(entry.machineId, batch)
    }

    logger.info(
      `[DevLiveTelemetry] Buffers pré-carregados (${payload.entries.length} máquinas)`
    )
  } catch (error) {
    logger.warn('[DevLiveTelemetry] Falha ao carregar seed live', error)
  }
}
