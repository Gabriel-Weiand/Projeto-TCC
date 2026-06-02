import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Telemetry from '#models/telemetry'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import Notification from '#models/notification'
import { DateTime } from 'luxon'

export default class extends BaseSeeder {
  async run() {
    const LAB_TZ = 'America/Sao_Paulo'
    const today = DateTime.now().setZone(LAB_TZ).startOf('day')

    /** Horário local do parque → UTC no banco */
    function at(day: DateTime, hour: number, minute: number = 0): DateTime {
      return day.set({ hour, minute, second: 0, millisecond: 0 }).toUTC()
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
        isSudo: true,
      },
      {
        userId: 4,
        machineId: 9,
        startTime: at(today.minus({ days: 21 }), 9),
        endTime: at(today.minus({ days: 7 }), 20),
        reason: 'Detecção + tracking CUDA em vídeo esportivo (2 semanas)',
        status: 'finished' as const,
        isSudo: false,
      },
      {
        userId: 5,
        machineId: 5,
        startTime: at(today.minus({ days: 35 }), 8),
        endTime: at(today.minus({ days: 8 }), 18),
        reason: 'Simulação optical flow + métricas PSNR (4 semanas)',
        status: 'finished' as const,
        isSudo: true,
      },
      {
        userId: 6,
        machineId: 3,
        startTime: at(today.minus({ days: 10 }), 10),
        endTime: at(today.minus({ days: 10 }), 11, 30),
        reason: 'Teste rápido de ambiente CUDA',
        status: 'finished' as const,
        isSudo: false,
      },

      // —— Em andamento (barras longas no Gantt) ——
      {
        userId: 3,
        machineId: 1,
        startTime: at(today.minus({ days: 12 }), 8),
        endTime: at(today.plus({ days: 16 }), 22),
        reason: 'TCC — pipeline VideoMAE + exportação H.265 (4 semanas)',
        status: 'approved' as const,
        isSudo: true,
      },
      {
        userId: 4,
        machineId: 9,
        startTime: at(today.minus({ days: 4 }), 9),
        endTime: at(today.plus({ days: 10 }), 20),
        reason: 'Benchmark inferência CUDA — modelos leves de vídeo (2 semanas)',
        status: 'approved' as const,
        isSudo: false,
      },
      {
        userId: 5,
        machineId: 2,
        startTime: at(today.minus({ days: 2 }), 14),
        endTime: at(today.plus({ days: 12 }), 23),
        reason: 'Treino distribuído NeRF em sequências 4K (≈2 semanas)',
        status: 'approved' as const,
        isSudo: false,
      },

      // —— Futuras aprovadas / pendentes ——
      {
        userId: 6,
        machineId: 3,
        startTime: at(today.plus({ days: 3 }), 8),
        endTime: at(today.plus({ days: 24 }), 20),
        reason: 'Reserva 3 semanas — RTX A6000 para diffusion vídeo',
        status: 'approved' as const,
        isSudo: false,
      },
      {
        userId: 7,
        machineId: 5,
        startTime: at(today.plus({ days: 7 }), 8),
        endTime: at(today.plus({ days: 28 }), 18),
        reason: 'Simulação estabilização + CUDA (3 semanas) — aguardando confirmação',
        status: 'pending' as const,
        isSudo: false,
      },
      {
        userId: 8,
        machineId: 7,
        startTime: at(today.plus({ days: 14 }), 10),
        endTime: at(today.plus({ days: 21 }), 18),
        reason: 'Ablação arquitetura — 1 semana',
        status: 'approved' as const,
        isSudo: false,
      },

      // —— Cancelada (curta) ——
      {
        userId: 4,
        machineId: 1,
        startTime: at(today.minus({ days: 40 }), 8),
        endTime: at(today.minus({ days: 33 }), 18),
        reason: 'Reserva semanal cancelada — conflito de orientação',
        status: 'cancelled' as const,
        isSudo: false,
      },
    ]

    const allocations = []
    for (const a of allocationsData) {
      allocations.push(await Allocation.create(a))
    }

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
        avgMoboTemp: 48,
        maxMoboTemp: 56,
        sessionDurationMinutes: 14 * 24 * 60 - 600,
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
        avgMoboTemp: 45,
        maxMoboTemp: 52,
        sessionDurationMinutes: 14 * 24 * 60,
      },
    ]

    for (const m of metricsData) {
      await AllocationMetric.create(m)
    }

    const telemetryData = [
      {
        allocationId: allocations[3].id,
        timestamp: at(today.minus({ days: 10 }), 10, 0).toISO()!,
        cpuUsage: 150,
        cpuTemp: 420,
        gpuUsage: 0,
        gpuTemp: 350,
        vramTotalGb: 480,
        vramUsedGb: 40,
        ramTotalGb: 2560,
        ramUsedGb: 800,
      },
      {
        allocationId: allocations[3].id,
        timestamp: at(today.minus({ days: 10 }), 10, 20).toISO()!,
        cpuUsage: 850,
        cpuTemp: 780,
        gpuUsage: 620,
        gpuTemp: 720,
        vramTotalGb: 480,
        vramUsedGb: 120,
        ramTotalGb: 2560,
        ramUsedGb: 1400,
      },
    ]

    for (const t of telemetryData) {
      await Telemetry.create(t)
    }

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
      { userId: 1, title: 'SSH — tentativas bloqueadas', message: 'Falhas de login em PC-LAB-01.', isRead: false },
    ]

    for (const n of notifData) {
      await Notification.create(n)
    }

    console.log('\n✅ Seed de alocações (reservas semanais+) concluído.\n')
  }
}
