import Allocation from '#models/allocation'
import Machine from '#models/machine'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import Notification from '#models/notification'
import { DateTime } from 'luxon'
import type { UsageProfile } from '#services/dev/seed_chart_series'
import {
  writeLiveTelemetrySeedFile,
  type LiveTelemetrySeedEntry,
} from '#services/dev/live_telemetry_seed'
import { TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX } from '#services/telemetry/presets'

/**
 * Alocações ativas do parque + telemetria ao vivo, tentativas SSH e notificações.
 *
 * Regras do seed:
 * - Todas as máquinas, exceto GaciS1, ficam ocupadas/ativas a partir do seed.
 * - GaciS1 permanece livre (online, sem reserva).
 * - Admin (id 1), Professor (id 2) e Usuário 1 (id 5) não recebem alocações.
 * - Cada reserva dura entre 3 dias e 2 semanas e abrange o "agora".
 * - O Notebook-server só existe no perfil dev; sua alocação é ignorada no lab.
 */
export async function seedParkAllocations() {
  const LAB_TZ = 'America/Sao_Paulo'
  const today = DateTime.now().setZone(LAB_TZ).startOf('day')

  const machines = await Machine.all()
  const machineByName = new Map(machines.map((m) => [m.name, m]))

  function at(day: DateTime, hour: number, minute: number = 0): DateTime {
    return day.set({ hour, minute, second: 0, millisecond: 0 }).toUTC()
  }

  type ActiveAllocationSeed = {
    userId: number
    machineName: string
    startDaysAgo: number
    endDaysAhead: number
    startHour: number
    endHour: number
    reason: string
    profile: UsageProfile
  }

  // Uma reserva ativa por máquina (exceto GaciS1). Durações entre 3 e 14 dias.
  const activeSeeds: ActiveAllocationSeed[] = [
    {
      userId: 3, // Gabriel Santos
      machineName: 'Euler',
      startDaysAgo: 2,
      endDaysAhead: 5,
      startHour: 9,
      endHour: 18,
      reason: 'Treino CUDA — RTX A6000 (`ssh -p 50000 user@euler.lab.local`)',
      profile: 'training_burst',
    },
    {
      userId: 4, // Usuário 2
      machineName: 'GaciG1',
      startDaysAgo: 1,
      endDaysAhead: 4,
      startHour: 10,
      endHour: 19,
      reason: 'Processamento numérico CPU — Xeon GaciG1',
      profile: 'cpu_batch',
    },
    {
      userId: 6, // Ana Costa
      machineName: 'GaciG2',
      startDaysAgo: 3,
      endDaysAhead: 7,
      startHour: 8,
      endHour: 20,
      reason: 'Pipeline batch FFmpeg + pré-processamento (servidor CPU)',
      profile: 'cpu_batch',
    },
    {
      userId: 7, // Carlos Mendes
      machineName: 'Sócrates',
      startDaysAgo: 4,
      endDaysAhead: 3,
      startHour: 8,
      endHour: 20,
      reason: 'Inferência RTX 3070 — acesso via AnyDesk',
      profile: 'inference_gaps',
    },
    {
      userId: 3, // Gabriel Santos
      machineName: 'Darwin',
      startDaysAgo: 1,
      endDaysAhead: 12,
      startHour: 14,
      endHour: 18,
      reason: 'Fine-tuning diffusion — RTX 3080 (AnyDesk)',
      profile: 'training_burst',
    },
    {
      userId: 4, // Usuário 2 (somente dev — Notebook-server)
      machineName: 'Notebook-server',
      startDaysAgo: 2,
      endDaysAhead: 4,
      startHour: 9,
      endHour: 17,
      reason: 'Testes de integração no notebook-server (GTX 1050 Ti)',
      profile: 'inference_gaps',
    },
  ]

  const liveEntries: LiveTelemetrySeedEntry[] = []
  const createdSummaries: string[] = []

  for (const seed of activeSeeds) {
    const machine = machineByName.get(seed.machineName)
    if (!machine) continue // Notebook-server ausente no perfil lab.

    const allocation = await Allocation.create({
      userId: seed.userId,
      machineId: machine.id,
      startTime: at(today.minus({ days: seed.startDaysAgo }), seed.startHour),
      endTime: at(today.plus({ days: seed.endDaysAhead }), seed.endHour),
      reason: seed.reason,
      status: 'approved',
    })

    const hasGpu = Boolean(machine.gpuModel)
    liveEntries.push({
      machineId: machine.id,
      allocationId: allocation.id,
      hasGpu,
      ramTotalGbWire: machine.totalRamGb ?? 320,
      vramTotalGbWire: machine.totalVramGb,
      profile: seed.profile,
      intervalSeconds: hasGpu ? 5 : 15,
      sampleCount: 15,
      mode: 'active',
      includeProcessCapture: true,
      processTopX: hasGpu ? TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX : 10,
    })

    const durationDays = seed.startDaysAgo + seed.endDaysAhead
    createdSummaries.push(`${machine.name} (user #${seed.userId}, ${durationDays}d)`)
  }

  writeLiveTelemetrySeedFile(liveEntries)

  console.log('\n--- Alocações ativas do parque ---')
  console.log(`  ${createdSummaries.join('\n  ')}`)
  console.log('  GaciS1: livre (sem reserva)')
  console.log('---\n')

  // Tentativas SSH recentes (somente máquinas com SSH exposto e que existam).
  const sshSeeds = [
    {
      machineName: 'Euler',
      sourceIp: '118.25.100.12',
      targetUsername: 'root',
      status: 'failed' as const,
      authMethod: 'password',
      clientFingerprint: null,
      createdAt: DateTime.now().minus({ hours: 5 }),
    },
    {
      machineName: 'Euler',
      sourceIp: '192.168.8.55',
      targetUsername: 'lab.gabriel_santos',
      status: 'success' as const,
      authMethod: 'publickey',
      clientFingerprint: 'SHA256:IPfakeUserKey1',
      createdAt: DateTime.now().minus({ hours: 2 }),
    },
    {
      machineName: 'GaciG2',
      sourceIp: '192.168.8.60',
      targetUsername: 'lab.ana_costa',
      status: 'success' as const,
      authMethod: 'publickey',
      clientFingerprint: 'SHA256:IPfakeUserKey6',
      createdAt: DateTime.now().minus({ minutes: 40 }),
    },
    {
      machineName: 'GaciG1',
      sourceIp: '192.168.8.61',
      targetUsername: 'lab.usuario_2',
      status: 'success' as const,
      authMethod: 'publickey',
      clientFingerprint: 'SHA256:IPfakeUserKey4',
      createdAt: DateTime.now().minus({ minutes: 20 }),
    },
  ]

  for (const s of sshSeeds) {
    const machine = machineByName.get(s.machineName)
    if (!machine) continue
    await SshConnectionAttempt.create({
      machineId: machine.id,
      sourceIp: s.sourceIp,
      targetUsername: s.targetUsername,
      status: s.status,
      authMethod: s.authMethod,
      clientFingerprint: s.clientFingerprint,
      createdAt: s.createdAt,
    })
  }

  // Notificações coerentes com as reservas ativas e usuários existentes.
  const notifData = [
    {
      userId: 3,
      title: 'Reserva aprovada — Euler',
      message: 'Sua reserva na RTX A6000 está ativa. Use `ssh -p 50000`.',
      isRead: false,
    },
    {
      userId: 4,
      title: 'Reserva aprovada — GaciG1',
      message: 'Processamento CPU liberado no servidor GaciG1.',
      isRead: false,
    },
    {
      userId: 6,
      title: 'Reserva aprovada — GaciG2',
      message: 'Pipeline batch CPU aprovado (sem métricas de GPU).',
      isRead: true,
      readAt: DateTime.now().minus({ hours: 3 }),
    },
    {
      userId: 7,
      title: 'Reserva aprovada — Sócrates',
      message: 'Acesso por AnyDesk à RTX 3070 liberado.',
      isRead: false,
    },
    {
      userId: 1,
      title: 'SSH — tentativa bloqueada',
      message: 'Falha de login (root) em Euler.',
      isRead: false,
    },
  ]

  for (const n of notifData) {
    await Notification.create(n)
  }

  console.log('✅ Seed de alocações concluído (live telemetry → storage/lab/live_telemetry_seed.json).\n')
}
