import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Telemetry from '#models/telemetry'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

/**
 * Calcula métricas agregadas a partir das telemetrias de uma alocação.
 */
export function calculateMetrics(telemetries: Telemetry[], allocation: Allocation) {
  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  const max = (values: number[]) => Math.max(...values)
  const avgOrNull = (values: number[]) => (values.length > 0 ? avg(values) : null)
  const maxOrNull = (values: number[]) => (values.length > 0 ? max(values) : null)

  const cpuUsages = telemetries.map((t) => t.cpuUsage)
  const cpuTemps = telemetries.map((t) => t.cpuTemp)
  const gpuUsages = telemetries.map((t) => t.gpuUsage)
  const gpuTemps = telemetries.map((t) => t.gpuTemp)
  const ramUsed = telemetries
    .map((t) => t.ramUsedGb)
    .filter((t): t is number => typeof t === 'number')
  const swapUsed = telemetries
    .map((t) => t.swapUsedGb)
    .filter((t): t is number => typeof t === 'number')
  const diskRead = telemetries
    .map((t) => t.diskReadMbps)
    .filter((t): t is number => typeof t === 'number')
  const diskWrite = telemetries
    .map((t) => t.diskWriteMbps)
    .filter((t): t is number => typeof t === 'number')
  const download = telemetries
    .map((t) => t.downloadMbps)
    .filter((t): t is number => typeof t === 'number')
  const upload = telemetries
    .map((t) => t.uploadMbps)
    .filter((t): t is number => typeof t === 'number')
  const moboTemps = telemetries
    .map((t) => t.moboTemperature)
    .filter((t): t is number => typeof t === 'number')
  const gpuPower = telemetries
    .map((t) => t.gpuPowerWatts)
    .filter((t): t is number => typeof t === 'number')
  const vramTotal = telemetries
    .map((t) => t.vramTotalMb)
    .filter((t): t is number => typeof t === 'number')
  const vramUsed = telemetries
    .map((t) => t.vramUsedMb)
    .filter((t): t is number => typeof t === 'number')

  const durationMs = allocation.endTime.diff(allocation.startTime).milliseconds
  const sessionDurationMinutes = Math.round(durationMs / 60000)

  return {
    avgCpuUsage: avg(cpuUsages),
    maxCpuUsage: max(cpuUsages),
    avgCpuTemp: avg(cpuTemps),
    maxCpuTemp: max(cpuTemps),

    avgGpuUsage: avg(gpuUsages),
    maxGpuUsage: max(gpuUsages),
    avgGpuTemp: avg(gpuTemps),
    maxGpuTemp: max(gpuTemps),

    avgGpuPowerWatts: avgOrNull(gpuPower),
    maxGpuPowerWatts: maxOrNull(gpuPower),
    avgVramTotalMb: avgOrNull(vramTotal),
    maxVramTotalMb: maxOrNull(vramTotal),
    avgVramUsedMb: avgOrNull(vramUsed),
    maxVramUsedMb: maxOrNull(vramUsed),

    avgRamUsedGb: avgOrNull(ramUsed),
    maxRamUsedGb: maxOrNull(ramUsed),
    avgSwapUsedGb: avgOrNull(swapUsed),
    maxSwapUsedGb: maxOrNull(swapUsed),

    avgDiskReadMbps: avgOrNull(diskRead),
    maxDiskReadMbps: maxOrNull(diskRead),
    avgDiskWriteMbps: avgOrNull(diskWrite),
    maxDiskWriteMbps: maxOrNull(diskWrite),

    avgDownloadMbps: avgOrNull(download),
    maxDownloadMbps: maxOrNull(download),
    avgUploadMbps: avgOrNull(upload),
    maxUploadMbps: maxOrNull(upload),

    avgMoboTemp: avgOrNull(moboTemps),
    maxMoboTemp: maxOrNull(moboTemps),

    sessionDurationMinutes,
  }
}

/**
 * Gera o resumo (AllocationMetric) para uma alocação.
 * Retorna null se já existe resumo ou se não há telemetrias.
 */
export async function summarizeAllocation(
  allocation: Allocation
): Promise<AllocationMetric | null> {
  const existing = await AllocationMetric.findBy('allocationId', allocation.id)
  if (existing) return null

  const telemetries = await Telemetry.query().where('allocationId', allocation.id)
  if (telemetries.length === 0) return null

  const metrics = calculateMetrics(telemetries, allocation)

  return AllocationMetric.create({
    allocationId: allocation.id,
    ...metrics,
  })
}

/**
 * Finaliza alocações aprovadas cujo endTime já passou.
 * Para cada uma: muda status para 'finished' e tenta gerar o resumo.
 *
 * Usa comparação em JavaScript (toMillis) em vez de SQL string comparison
 * para evitar problemas de formato entre ISO e o formato do SQLite.
 */
export async function autoFinalizeExpired(): Promise<number> {
  const nowMs = DateTime.now().toMillis()

  const approved = await Allocation.query().where('status', 'approved')

  const expired = approved.filter((a) => a.endTime.toMillis() < nowMs)

  let count = 0
  for (const allocation of expired) {
    try {
      allocation.status = 'finished'
      await allocation.save()

      await summarizeAllocation(allocation)
      count++
    } catch (error) {
      logger.error(`[AutoFinalize] Failed for allocation ${allocation.id}:`, error)
    }
  }

  return count
}
