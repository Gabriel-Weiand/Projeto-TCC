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

  const cpuUsages = telemetries.map((t) => t.cpuUsage)
  const cpuTemps = telemetries.map((t) => t.cpuTemp)
  const gpuUsages = telemetries.map((t) => t.gpuUsage)
  const gpuTemps = telemetries.map((t) => t.gpuTemp)
  const ramUsages = telemetries.map((t) => t.ramUsage)
  const diskUsages = telemetries.map((t) => t.diskUsage).filter((t): t is number => t !== null)
  const downloadUsages = telemetries
    .map((t) => t.downloadUsage)
    .filter((t): t is number => t !== null)
  const uploadUsages = telemetries.map((t) => t.uploadUsage).filter((t): t is number => t !== null)
  const moboTemps = telemetries.map((t) => t.moboTemperature).filter((t): t is number => t !== null)

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

    avgRamUsage: avg(ramUsages),
    maxRamUsage: max(ramUsages),

    avgDiskUsage: diskUsages.length > 0 ? avg(diskUsages) : null,
    maxDiskUsage: diskUsages.length > 0 ? max(diskUsages) : null,

    avgDownloadUsage: downloadUsages.length > 0 ? avg(downloadUsages) : null,
    maxDownloadUsage: downloadUsages.length > 0 ? max(downloadUsages) : null,
    avgUploadUsage: uploadUsages.length > 0 ? avg(uploadUsages) : null,
    maxUploadUsage: uploadUsages.length > 0 ? max(uploadUsages) : null,

    avgMoboTemp: moboTemps.length > 0 ? avg(moboTemps) : null,
    maxMoboTemp: moboTemps.length > 0 ? max(moboTemps) : null,

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
