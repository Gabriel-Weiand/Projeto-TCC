import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Telemetry from '#models/telemetry'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { notifyAllocationAutoFinished } from '#services/notification_service'
import { sftpEndsAt } from '#services/allocation_access'
import {
  downsampleToBuckets,
  parseTimestampMs,
  resolveChartBucketMs,
  chartBucketMinutes,
  type ChartSeriesPoint,
  type TelemetrySample,
} from '#services/telemetry_downsample'

function telemetryToSample(row: Telemetry): TelemetrySample {
  return {
    timestamp: row.timestamp,
    cpuUsage: row.cpuUsage,
    cpuTemp: row.cpuTemp,
    cpuFreqMhz: row.cpuFreqMhz ?? undefined,
    gpuUsage: row.gpuUsage,
    gpuTemp: row.gpuTemp,
    gpuPowerWatts: row.gpuPowerWatts ?? undefined,
    vramTotalGb: row.vramTotalGb ?? undefined,
    vramUsedGb: row.vramUsedGb ?? undefined,
    ramTotalGb: row.ramTotalGb ?? undefined,
    ramUsedGb: row.ramUsedGb ?? undefined,
    swapTotalGb: row.swapTotalGb ?? undefined,
    swapUsedGb: row.swapUsedGb ?? undefined,
    diskReadMbps: row.diskReadMbps ?? undefined,
    diskWriteMbps: row.diskWriteMbps ?? undefined,
    downloadMbps: row.downloadMbps ?? undefined,
    uploadMbps: row.uploadMbps ?? undefined,
    moboTemperature: row.moboTemperature ?? undefined,
  }
}

/**
 * Gera série temporal resumida para gráfico (bucket adaptativo à duração da sessão).
 */
export function buildAllocationChartSeries(
  telemetries: Telemetry[],
  allocation: Allocation
): { points: ChartSeriesPoint[]; bucketMs: number } {
  if (telemetries.length === 0) {
    return { points: [], bucketMs: resolveChartBucketMs(0) }
  }

  const rangeStartMs = allocation.startTime.toMillis()
  const rangeEndMs = allocation.endTime.toMillis()
  const bucketMs = resolveChartBucketMs(rangeEndMs - rangeStartMs)

  const inRange = telemetries.filter((row) => {
    const ts = parseTimestampMs(row.timestamp)
    return ts >= rangeStartMs && ts <= rangeEndMs
  })

  if (inRange.length === 0) {
    return { points: [], bucketMs }
  }

  const samples = inRange.map(telemetryToSample)
  return {
    points: downsampleToBuckets(samples, bucketMs, rangeStartMs, rangeEndMs),
    bucketMs,
  }
}

/**
 * Calcula métricas agregadas usando Time-Weighted Average (Média Ponderada no Tempo).
 */
export function calculateMetrics(telemetries: Telemetry[], allocation: Allocation) {
  if (telemetries.length === 0) throw new Error('Cannot summarize empty telemetries')

  // 1. Garantir que as telemetrias estão ordenadas cronologicamente
  const sorted = [...telemetries].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  })

  const allocEndTimeMs = allocation.endTime.toMillis()

  /**
   * Função interna que calcula o TWA e o Max para uma propriedade específica.
   */
  const getTwaAndMax = (key: keyof Telemetry) => {
    let weightedSum = 0
    let totalWeight = 0
    let max = -Infinity
    let hasData = false

    for (let i = 0; i < sorted.length; i++) {
      const val = sorted[i][key]

      // Ignora leituras que vieram nulas (ex: máquina não suporta a métrica)
      if (typeof val !== 'number') continue

      hasData = true
      if (val > max) max = val

      const currentT = new Date(sorted[i].timestamp).getTime()

      // O "peso" (duração) dessa leitura é o tempo até a PRÓXIMA leitura.
      // Se for a última leitura da sessão, o peso é o tempo até o fim da alocação.
      let nextT =
        i < sorted.length - 1 ? new Date(sorted[i + 1].timestamp).getTime() : allocEndTimeMs

      let weight = nextT - currentT
      if (weight < 0) weight = 0 // Evita pesos negativos se o relógio bagunçar

      weightedSum += val * weight
      totalWeight += weight
    }

    if (!hasData) return { avg: null, max: null }

    // Retorna a média arredondada para manter integridade com o banco (inteiros nas temperaturas, etc)
    return {
      avg: totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null,
      max: max,
    }
  }

  // 2. Aplicar a função para cada métrica
  const cpuUsage = getTwaAndMax('cpuUsage')
  const cpuTemp = getTwaAndMax('cpuTemp')

  const gpuUsage = getTwaAndMax('gpuUsage')
  const gpuTemp = getTwaAndMax('gpuTemp')
  const gpuPower = getTwaAndMax('gpuPowerWatts')
  const vramTotal = getTwaAndMax('vramTotalGb')
  const vramUsed = getTwaAndMax('vramUsedGb')

  const ramUsed = getTwaAndMax('ramUsedGb')
  const swapUsed = getTwaAndMax('swapUsedGb')

  const diskRead = getTwaAndMax('diskReadMbps')
  const diskWrite = getTwaAndMax('diskWriteMbps')

  const download = getTwaAndMax('downloadMbps')
  const upload = getTwaAndMax('uploadMbps')

  const moboTemp = getTwaAndMax('moboTemperature')

  // Duração real da sessão
  const durationMs = allocation.endTime.diff(allocation.startTime).milliseconds
  const sessionDurationMinutes = Math.round(durationMs / 60000)

  return {
    avgCpuUsage: cpuUsage.avg!,
    maxCpuUsage: cpuUsage.max!,
    avgCpuTemp: cpuTemp.avg!,
    maxCpuTemp: cpuTemp.max!,

    avgGpuUsage: gpuUsage.avg!,
    maxGpuUsage: gpuUsage.max!,
    avgGpuTemp: gpuTemp.avg!,
    maxGpuTemp: gpuTemp.max!,

    avgGpuPowerWatts: gpuPower.avg,
    maxGpuPowerWatts: gpuPower.max,
    avgVramTotalGb: vramTotal.avg, // Ajustado para VRAM em GB
    maxVramTotalGb: vramTotal.max,
    avgVramUsedGb: vramUsed.avg,
    maxVramUsedGb: vramUsed.max,

    avgRamUsedGb: ramUsed.avg,
    maxRamUsedGb: ramUsed.max,
    avgSwapUsedGb: swapUsed.avg,
    maxSwapUsedGb: swapUsed.max,

    avgDiskReadMbps: diskRead.avg,
    maxDiskReadMbps: diskRead.max,
    avgDiskWriteMbps: diskWrite.avg,
    maxDiskWriteMbps: diskWrite.max,

    avgDownloadMbps: download.avg,
    maxDownloadMbps: download.max,
    avgUploadMbps: upload.avg,
    maxUploadMbps: upload.max,

    avgMoboTemp: moboTemp.avg,
    maxMoboTemp: moboTemp.max,

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
  const { points: chartSeries, bucketMs } = buildAllocationChartSeries(telemetries, allocation)

  const metric = await AllocationMetric.create({
    allocationId: allocation.id,
    ...metrics,
    chartSeries: chartSeries as unknown as Record<string, unknown>[],
    chartBucketMinutes: chartBucketMinutes(bucketMs),
  })

  await Telemetry.query().where('allocationId', allocation.id).delete()

  return metric
}

/**
 * Finaliza alocações aprovadas após a janela SFTP pós-reserva (end + grace + postSftp).
 * Para cada uma: muda status para 'finished' e tenta gerar o resumo.
 */
export async function autoFinalizeExpired(): Promise<number> {
  const now = DateTime.utc()

  const approved = await Allocation.query().where('status', 'approved')

  const expired = approved.filter((a) => now.toMillis() > sftpEndsAt(a).toMillis())

  let count = 0
  for (const allocation of expired) {
    try {
      allocation.status = 'finished'
      await allocation.save()
      await allocation.load('machine')
      await notifyAllocationAutoFinished(allocation, allocation.machine)
      await summarizeAllocation(allocation)
      count++
    } catch (error) {
      logger.error(`[AutoFinalize] Failed for allocation ${allocation.id}:`, error)
    }
  }

  return count
}
