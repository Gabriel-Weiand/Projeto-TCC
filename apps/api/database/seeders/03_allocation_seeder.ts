import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Telemetry from '#models/telemetry'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import Notification from '#models/notification'
import { DateTime } from 'luxon'
import {
  generateChartSeriesWire,
  generateRawTelemetriesWire,
  createTelemetriesInChunks,
} from '#services/seed_chart_series'
import { resolveChartBucketMs, chartBucketMinutes } from '#services/telemetry_downsample'

export default class extends BaseSeeder {
  async run() {
    const LAB_TZ = 'America/Sao_Paulo'
    const today = DateTime.now().setZone(LAB_TZ).startOf('day')

    /** Horário local do parque → UTC no banco */
    function at(day: DateTime, hour: number, minute: number = 0): DateTime {
      return day.set({ hour, minute, second: 0, millisecond: 0 }).toUTC()
    }

    function chartSeedForAllocation(allocation: Allocation, overrides?: { pointCount?: number }) {
      const startMs = allocation.startTime.toMillis()
      const endMs = allocation.endTime.toMillis()
      const durationMs = endMs - startMs
      const bucketMs = resolveChartBucketMs(durationMs)
      const pointCount =
        overrides?.pointCount ?? Math.max(2, Math.ceil(durationMs / bucketMs))
      return {
        chartSeries: generateChartSeriesWire(startMs, endMs, { pointCount }),
        chartBucketMinutes: chartBucketMinutes(bucketMs),
      }
    }

    const allocationsData = [
      // —— Concluídas (sessões longas no passado) ——
      {
        userId: 3,
        machineId: 2,
        startTime: at(today.minus({ days: 28 }), 8),
        endTime: at(today.minus({ days: 14 }), 22),
        reason: 'Fine-tuning SlowFast — corpus UFPel (2 semanas)',
        status: 'finished' as const,
      },
      {
        userId: 4,
        machineId: 9,
        startTime: at(today.minus({ days: 21 }), 9),
        endTime: at(today.minus({ days: 7 }), 20),
        reason: 'Detecção + tracking CUDA em vídeo esportivo (2 semanas)',
        status: 'finished' as const,
      },
      {
        userId: 5,
        machineId: 5,
        startTime: at(today.minus({ days: 35 }), 8),
        endTime: at(today.minus({ days: 8 }), 18),
        reason: 'Simulação optical flow + métricas PSNR (4 semanas)',
        status: 'finished' as const,
      },
      {
        userId: 6,
        machineId: 3,
        startTime: at(today.minus({ days: 10 }), 10),
        endTime: at(today.minus({ days: 10 }), 11, 30),
        reason: 'Teste rápido de ambiente CUDA',
        status: 'finished' as const,
      },
      // —— Gabriel — demo SSH (fingerprint + porta padrão vs custom) ——
      {
        userId: 3,
        machineId: 8,
        startTime: at(today.minus({ days: 1 }), 14),
        endTime: at(today.plus({ days: 6 }), 18),
        reason: 'Ingestão corpora 4K — comando `ssh user@ip` (porta 22)',
        status: 'approved' as const,
      },
      {
        userId: 3,
        machineId: 3,
        startTime: at(today, 9),
        endTime: at(today.plus({ days: 5 }), 21),
        reason: 'RTX A6000 — diffusion vídeo (`ssh -p 8022 user@ip`)',
        status: 'approved' as const,
      },
      {
        userId: 3,
        machineId: 7,
        startTime: at(today.plus({ days: 2 }), 10),
        endTime: at(today.plus({ days: 3 }), 16),
        reason: 'Protótipo CNN leve — sessão curta (SSH -p 2222)',
        status: 'approved' as const,
      },
      {
        userId: 3,
        machineId: 5,
        startTime: at(today.plus({ days: 9 }), 8),
        endTime: at(today.plus({ days: 16 }), 20),
        reason: 'Optical flow CUDA — conferir host fingerprint antes do 1º acesso (-p 22022)',
        status: 'approved' as const,
      },
      {
        userId: 4,
        machineId: 9,
        startTime: at(today.minus({ days: 4 }), 9),
        endTime: at(today.plus({ days: 10 }), 20),
        reason: 'Benchmark inferência CUDA — modelos leves de vídeo (2 semanas)',
        status: 'approved' as const,
      },
      {
        userId: 5,
        machineId: 2,
        startTime: at(today.minus({ days: 2 }), 14),
        endTime: at(today.plus({ days: 12 }), 23),
        reason: 'Treino distribuído NeRF em sequências 4K (≈2 semanas)',
        status: 'approved' as const,
      },

      // —— Futuras aprovadas / pendentes ——
      {
        userId: 6,
        machineId: 3,
        startTime: at(today.plus({ days: 6 }), 8),
        endTime: at(today.plus({ days: 24 }), 20),
        reason: 'Reserva 3 semanas — RTX A6000 para diffusion vídeo',
        status: 'approved' as const,
      },
      {
        userId: 7,
        machineId: 5,
        startTime: at(today.plus({ days: 7 }), 8),
        endTime: at(today.plus({ days: 28 }), 18),
        reason: 'Simulação estabilização + CUDA (3 semanas) — aguardando confirmação',
        status: 'pending' as const,
      },
      {
        userId: 8,
        machineId: 7,
        startTime: at(today.plus({ days: 14 }), 10),
        endTime: at(today.plus({ days: 21 }), 18),
        reason: 'Ablação arquitetura — 1 semana',
        status: 'approved' as const,
      },

      // —— TESTes Gabriel: gerar resumo na hora (sem allocation_metrics) ——
      {
        userId: 3,
        machineId: 1,
        startTime: at(today.minus({ days: 1 }), 14, 0),
        endTime: at(today.minus({ days: 1 }), 14, 45),
        reason: '[TEST-A] Curta · eco ~60s · <100 amostras · Gerar resumo',
        status: 'finished' as const,
      },
      {
        userId: 3,
        machineId: 2,
        startTime: at(today.minus({ days: 3 }), 9),
        endTime: at(today.minus({ days: 3 }), 17),
        reason: '[TEST-B] Média 8h · fast ~30s · Gerar resumo',
        status: 'finished' as const,
      },
      {
        userId: 3,
        machineId: 4,
        startTime: at(today.minus({ days: 6 }), 8),
        endTime: at(today.minus({ days: 3 }), 20),
        reason: '[TEST-C] Longa 3d · custom 300s · Gerar resumo',
        status: 'finished' as const,
      },
      {
        userId: 3,
        machineId: 5,
        startTime: at(today.minus({ days: 9 }), 8),
        endTime: at(today.minus({ days: 8 }), 8),
        reason: '[TEST-D] Longa 24h · fast ~15s · bruta densa · Gerar resumo',
        status: 'finished' as const,
      },
      {
        userId: 3,
        machineId: 6,
        startTime: at(today.minus({ days: 1 }), 16, 0),
        endTime: at(today.minus({ days: 1 }), 16, 20),
        reason: '[TEST-E] Curta 20min · fast ~10s · ~120 amostras · Gerar resumo',
        status: 'finished' as const,
      },

      // —— Cancelada (curta) ——
      {
        userId: 4,
        machineId: 1,
        startTime: at(today.minus({ days: 40 }), 8),
        endTime: at(today.minus({ days: 33 }), 18),
        reason: 'Reserva semanal cancelada — conflito de orientação',
        status: 'cancelled' as const,
      },
    ]

    const allocations = []
    for (const a of allocationsData) {
      allocations.push(await Allocation.create(a))
    }

    const chart0 = chartSeedForAllocation(allocations[0])
    const chart1 = chartSeedForAllocation(allocations[1])

    const metricsData = [
      {
        allocationId: allocations[0].id,
        avgCpuUsage: 620,
        maxCpuUsage: 980,
        avgCpuTemp: 680,
        maxCpuTemp: 880,
        avgGpuUsage: 910,
        maxGpuUsage: 1000,
        avgGpuTemp: 760,
        maxGpuTemp: 860,
        avgGpuPowerWatts: 320,
        maxGpuPowerWatts: 420,
        avgVramTotalGb: 240,
        maxVramTotalGb: 240,
        avgVramUsedGb: 215,
        maxVramUsedGb: 232,
        avgRamUsedGb: 1050,
        maxRamUsedGb: 1180,
        avgSwapUsedGb: 0,
        maxSwapUsedGb: 20,
        avgDiskReadMbps: 1200,
        maxDiskReadMbps: 2800,
        avgDiskWriteMbps: 680,
        maxDiskWriteMbps: 1400,
        avgDownloadMbps: 55,
        maxDownloadMbps: 220,
        avgUploadMbps: 18,
        maxUploadMbps: 90,
        avgMoboTemp: 480,
        maxMoboTemp: 560,
        sessionDurationMinutes: 14 * 24 * 60 - 600,
        chartBucketMinutes: chart0.chartBucketMinutes,
        chartSeries: chart0.chartSeries,
      },
      {
        allocationId: allocations[1].id,
        avgCpuUsage: 540,
        maxCpuUsage: 920,
        avgCpuTemp: 620,
        maxCpuTemp: 780,
        avgGpuUsage: 780,
        maxGpuUsage: 990,
        avgGpuTemp: 700,
        maxGpuTemp: 820,
        avgGpuPowerWatts: 180,
        maxGpuPowerWatts: 260,
        avgVramTotalGb: 80,
        maxVramTotalGb: 80,
        avgVramUsedGb: 62,
        maxVramUsedGb: 75,
        avgRamUsedGb: 220,
        maxRamUsedGb: 280,
        avgSwapUsedGb: 0,
        maxSwapUsedGb: 0,
        avgDiskReadMbps: 900,
        maxDiskReadMbps: 1800,
        avgDiskWriteMbps: 420,
        maxDiskWriteMbps: 900,
        avgDownloadMbps: 30,
        maxDownloadMbps: 120,
        avgUploadMbps: 8,
        maxUploadMbps: 40,
        avgMoboTemp: 450,
        maxMoboTemp: 520,
        sessionDurationMinutes: 14 * 24 * 60,
        chartBucketMinutes: chart1.chartBucketMinutes,
        chartSeries: chart1.chartSeries,
      },
    ]

    for (const m of metricsData) {
      await AllocationMetric.create(m)
    }

    const summaryTestCases: {
      allocation: Allocation
      intervalMs: number
      label: string
      options?: { gpuIntensity?: number; includeDiskIo?: boolean }
    }[] = [
      {
        allocation: allocations[13],
        intervalMs: 60_000,
        label: 'TEST-A',
        options: { gpuIntensity: 0.4, includeDiskIo: false },
      },
      {
        allocation: allocations[14],
        intervalMs: 30_000,
        label: 'TEST-B',
        options: { gpuIntensity: 0.7, includeDiskIo: true },
      },
      {
        allocation: allocations[15],
        intervalMs: 300_000,
        label: 'TEST-C',
        options: { gpuIntensity: 0.65, includeDiskIo: true },
      },
      {
        allocation: allocations[16],
        intervalMs: 15_000,
        label: 'TEST-D',
        options: { gpuIntensity: 0.75, includeDiskIo: true },
      },
      {
        allocation: allocations[17],
        intervalMs: 10_000,
        label: 'TEST-E',
        options: { gpuIntensity: 0.55, includeDiskIo: false },
      },
    ]

    console.log('\n📊 Alocações para gerar resumo (admin → Gerar resumo):')
    for (const test of summaryTestCases) {
      const startMs = test.allocation.startTime.toMillis()
      const endMs = test.allocation.endTime.toMillis()
      const rows = generateRawTelemetriesWire(test.allocation.id, startMs, endMs, test.intervalMs, {
        gpuIntensity: test.options?.gpuIntensity,
        includeDiskIo: test.options?.includeDiskIo,
      })
      await createTelemetriesInChunks((chunk) => Telemetry.createMany(chunk), rows)
      const durationMin = Math.round((endMs - startMs) / 60_000)
      console.log(
        `   ${test.label} · alocação #${test.allocation.id} · ${rows.length} brutas · ${durationMin} min · intervalo ${test.intervalMs / 1000}s`
      )
      console.log(`      → ${test.allocation.reason}`)
    }
    console.log(
      `   Pré-resumidas (~100 pts): alocações #${allocations[0].id}, #${allocations[1].id}\n`
    )

    const sshData = [
      {
        machineId: 1,
        sourceIp: '118.25.100.12',
        targetUsername: 'root',
        status: 'failed' as const,
        authMethod: 'password',
        createdAt: DateTime.now().minus({ hours: 5 }),
      },
      {
        machineId: 1,
        sourceIp: '192.168.8.55',
        targetUsername: 'lab.gabriel_santos',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey1',
        createdAt: DateTime.now().minus({ hours: 2 }),
      },
      {
        machineId: 3,
        sourceIp: '192.168.8.55',
        targetUsername: 'lab.gabriel_santos',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey1',
        createdAt: DateTime.now().minus({ minutes: 90 }),
      },
      {
        machineId: 2,
        sourceIp: '192.168.8.55',
        targetUsername: 'lab.gabriel_santos',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey1',
        createdAt: DateTime.now().minus({ minutes: 45 }),
      },
      {
        machineId: 9,
        sourceIp: '192.168.8.60',
        targetUsername: 'lab.maria_oliveira',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey2',
        createdAt: DateTime.now().minus({ minutes: 20 }),
      },
    ]

    for (const s of sshData) {
      await SshConnectionAttempt.create(s)
    }

    const notifData = [
      {
        userId: 3,
        title: 'Reserva longa aprovada',
        message: 'Sua reserva de 4 semanas em PC-LAB-01 está ativa.',
        isRead: false,
      },
      {
        userId: 3,
        title: 'Conectar em PC-LAB-03',
        message:
          'Reserva ativa na RTX A6000. Use `ssh -p 8022` e confira o host fingerprint no painel antes de aceitar.',
        isRead: false,
      },
      {
        userId: 3,
        title: 'Ingestão 4K — PC-LAB-08',
        message: 'SSH na porta padrão (22). O fingerprint do host aparece no modal Conectar.',
        isRead: true,
        readAt: DateTime.now().minus({ hours: 3 }),
      },
      {
        userId: 5,
        title: 'GPU RTX 4090 — segunda reserva',
        message: 'Compartilhamento de PC-LAB-02 com janela aprovada.',
        isRead: true,
        readAt: DateTime.now().minus({ days: 1 }),
      },
      {
        userId: 7,
        title: 'Reserva pendente',
        message: 'Aguardando aprovação da simulação CUDA (3 semanas).',
        isRead: false,
      },
      {
        userId: 1,
        title: 'SSH — tentativas bloqueadas',
        message: 'Falhas de login em PC-LAB-01.',
        isRead: false,
      },
    ]

    for (const n of notifData) {
      await Notification.create(n)
    }

    console.log('✅ Seed de alocações concluído.\n')
  }
}
