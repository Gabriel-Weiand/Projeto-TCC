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

    function labTime(base: DateTime, hour: number, minute: number = 0): DateTime {
      return base.set({ hour, minute }).toUTC()
    }

    const allocationsData = [
      {
        userId: 3,
        machineId: 1,
        startTime: labTime(today.minus({ days: 3 }), 8),
        endTime: labTime(today.minus({ days: 3 }), 14),
        reason: 'Treinamento IA',
        status: 'finished' as const,
        isSudo: true,
      },
      {
        userId: 4,
        machineId: 2,
        startTime: labTime(today.minus({ days: 1 }), 14),
        endTime: labTime(today.minus({ days: 1 }), 18),
        reason: 'NLP',
        status: 'finished' as const,
        isSudo: false,
      },
      {
        userId: 5,
        machineId: 3,
        startTime: labTime(today.minus({ days: 2 }), 10),
        endTime: labTime(today.minus({ days: 2 }), 11),
        reason: 'Compilação Kernel',
        status: 'finished' as const,
        isSudo: true,
      },
      {
        userId: 3,
        machineId: 1,
        startTime: labTime(today, 8),
        endTime: labTime(today, 23, 59),
        reason: 'Fine-tuning contínuo',
        status: 'approved' as const,
        isSudo: true,
      },
      {
        userId: 6,
        machineId: 7,
        startTime: labTime(today, 10),
        endTime: labTime(today, 18),
        reason: 'Programação Web',
        status: 'approved' as const,
        isSudo: false,
      },
      {
        userId: 4,
        machineId: 1,
        startTime: labTime(today.minus({ days: 5 }), 8),
        endTime: labTime(today.minus({ days: 5 }), 12),
        reason: 'Cancelou',
        status: 'cancelled' as const,
        isSudo: false,
      },
      {
        userId: 4,
        machineId: 1,
        startTime: labTime(today.plus({ days: 1 }), 8),
        endTime: labTime(today.plus({ days: 1 }), 12),
        reason: 'Avaliação',
        status: 'approved' as const,
        isSudo: false,
      },
      {
        userId: 7,
        machineId: 5,
        startTime: labTime(today.plus({ days: 1 }), 14),
        endTime: labTime(today.plus({ days: 1 }), 16),
        reason: 'Estudos',
        status: 'pending' as const,
        isSudo: false,
      },
      {
        userId: 4,
        machineId: 9,
        startTime: labTime(today.plus({ days: 2 }), 9),
        endTime: labTime(today.plus({ days: 2 }), 17),
        reason: 'Visão computacional',
        status: 'approved' as const,
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
        avgCpuUsage: 450,
        maxCpuUsage: 980,
        avgCpuTemp: 650,
        maxCpuTemp: 880,
        avgGpuUsage: 920,
        maxGpuUsage: 1000,
        avgGpuTemp: 740,
        maxGpuTemp: 840,
        avgGpuPowerWatts: 280,
        maxGpuPowerWatts: 350,
        avgVramTotalGb: 240,
        maxVramTotalGb: 240,
        avgVramUsedGb: 220,
        maxVramUsedGb: 235,
        avgRamUsedGb: 480,
        maxRamUsedGb: 600,
        avgSwapUsedGb: 0,
        maxSwapUsedGb: 50,
        avgDiskReadMbps: 880,
        maxDiskReadMbps: 1420,
        avgDiskWriteMbps: 510,
        maxDiskWriteMbps: 660,
        avgDownloadMbps: 45,
        maxDownloadMbps: 210,
        avgUploadMbps: 15,
        maxUploadMbps: 85,
        avgMoboTemp: 450,
        maxMoboTemp: 520,
        sessionDurationMinutes: 360,
      },
      {
        allocationId: allocations[1].id,
        avgCpuUsage: 650,
        maxCpuUsage: 950,
        avgCpuTemp: 550,
        maxCpuTemp: 720,
        avgGpuUsage: 350,
        maxGpuUsage: 800,
        avgGpuTemp: 580,
        maxGpuTemp: 680,
        avgGpuPowerWatts: 120,
        maxGpuPowerWatts: 250,
        avgVramTotalGb: 240,
        maxVramTotalGb: 240,
        avgVramUsedGb: 80,
        maxVramUsedGb: 150,
        avgRamUsedGb: 320,
        maxRamUsedGb: 540,
        avgSwapUsedGb: 0,
        maxSwapUsedGb: 0,
        avgDiskReadMbps: 120,
        maxDiskReadMbps: 450,
        avgDiskWriteMbps: 200,
        maxDiskWriteMbps: 500,
        avgDownloadMbps: 10,
        maxDownloadMbps: 50,
        avgUploadMbps: 2,
        maxUploadMbps: 10,
        avgMoboTemp: 400,
        maxMoboTemp: 450,
        sessionDurationMinutes: 240,
      },
    ]

    for (const m of metricsData) {
      await AllocationMetric.create(m)
    }

    const telemetryData = [
      {
        allocationId: allocations[2].id,
        timestamp: labTime(today.minus({ days: 2 }), 10, 0).toISO()!,
        cpuUsage: 100,
        cpuTemp: 400,
        gpuUsage: 0,
        gpuTemp: 350,
        vramTotalGb: 100,
        vramUsedGb: 20,
        ramTotalGb: 2560,
        ramUsedGb: 100,
      },
      {
        allocationId: allocations[2].id,
        timestamp: labTime(today.minus({ days: 2 }), 10, 15).toISO()!,
        cpuUsage: 900,
        cpuTemp: 850,
        gpuUsage: 500,
        gpuTemp: 700,
        vramTotalGb: 100,
        vramUsedGb: 80,
        ramTotalGb: 2560,
        ramUsedGb: 600,
      },
      {
        allocationId: allocations[2].id,
        timestamp: labTime(today.minus({ days: 2 }), 10, 45).toISO()!,
        cpuUsage: 500,
        cpuTemp: 600,
        gpuUsage: 200,
        gpuTemp: 500,
        vramTotalGb: 100,
        vramUsedGb: 80,
        ramTotalGb: 2560,
        ramUsedGb: 400,
      },
      {
        allocationId: allocations[2].id,
        timestamp: labTime(today.minus({ days: 2 }), 10, 55).toISO()!,
        cpuUsage: 0,
        cpuTemp: 350,
        gpuUsage: 0,
        gpuTemp: 300,
        vramTotalGb: 100,
        vramUsedGb: 0,
        ramTotalGb: 2560,
        ramUsedGb: 80,
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
        machineId: 1,
        sourceIp: '118.25.100.12',
        targetUsername: 'admin',
        status: 'invalid_user' as const,
        authMethod: 'password',
        createdAt: DateTime.now().minus({ hours: 5, minutes: 1 }),
      },
      {
        machineId: 1,
        sourceIp: '192.168.1.55',
        targetUsername: 'lab.gabriel_santos',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey1',
        createdAt: DateTime.now().minus({ minutes: 28 }),
      },
    ]

    for (const s of sshData) {
      await SshConnectionAttempt.create(s)
    }

    const notifData = [
      {
        userId: 3,
        title: 'Alocação Aprovada',
        message: 'Sua reserva foi aprovada.',
        isRead: false,
      },
      {
        userId: 3,
        title: 'Alerta de Sudo',
        message: 'Uso de comandos administrativos.',
        isRead: true,
        readAt: DateTime.now().minus({ days: 1 }),
      },
      { userId: 1, title: 'Ataque SSH', message: 'Múltiplas tentativas de SSH.', isRead: false },
    ]

    for (const n of notifData) {
      await Notification.create(n)
    }

    console.log('\n✅ Database seeded successfully without deadlocks!')
  }
}
