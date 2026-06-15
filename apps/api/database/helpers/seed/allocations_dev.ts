import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import Telemetry from '#models/telemetry'
import Machine from '#models/machine'
import SshConnectionAttempt from '#models/ssh_connection_attempt'
import Notification from '#models/notification'
import { DateTime } from 'luxon'
import {
  generateChartSeriesWire,
  generateRawTelemetriesWire,
  createTelemetriesInChunks,
  aggregateWireMetricsFromChart,
  type UsageProfile,
} from '#services/dev/seed_chart_series'
import { resolveChartBucketMs, chartBucketMinutes } from '#services/telemetry/downsample'
import { buildProcessSummary } from '#services/telemetry/process_summary'
import {
  writeLiveTelemetrySeedFile,
  type LiveTelemetrySeedEntry,
} from '#services/dev/live_telemetry_seed'
import {
  logTelemetryStorageReport,
  build24hTwoSecondScenarios,
  HOUR_MS,
  generateStorageScenarioSamples,
} from '#services/telemetry/storage_estimate'
import {
  DEFAULT_LAB_TELEMETRY_PRESETS,
  FULL_TELEMETRY_SET,
  TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
} from '#services/telemetry/presets'

/** Alocações, telemetrias, notificações e live seed — perfil dev. */
export async function seedDevAllocations() {
  const LAB_TZ = 'America/Sao_Paulo'
    const today = DateTime.now().setZone(LAB_TZ).startOf('day')

    const machines = await Machine.all()
    const machineByName = new Map(machines.map((m) => [m.name, m]))
    const mid = (name: string) => {
      const machine = machineByName.get(name)
      if (!machine) throw new Error(`Máquina seed "${name}" não encontrada`)
      return machine
    }

    function at(day: DateTime, hour: number, minute: number = 0): DateTime {
      return day.set({ hour, minute, second: 0, millisecond: 0 }).toUTC()
    }

    function hwFor(machine: Machine) {
      return {
        hasGpu: Boolean(machine.gpuModel),
        ramTotalGbWire: machine.totalRamGb ?? 320,
        vramTotalGbWire: machine.totalVramGb,
      }
    }

    function processSummaryForAllocation(
      allocation: Allocation,
      machine: Machine,
      profile: UsageProfile,
      processTopX = 10
    ) {
      const startMs = allocation.startTime.toMillis()
      const endMs = allocation.endTime.toMillis()
      const durationMs = endMs - startMs
      const hw = hwFor(machine)
      const intervalMs = Math.max(
        60_000,
        Math.min(300_000, Math.floor(durationMs / Math.max(120, Math.ceil(durationMs / 300_000))))
      )
      const raw = generateRawTelemetriesWire(allocation.id, startMs, endMs, intervalMs, {
        profile,
        ...hw,
        includeDiskIo: profile === 'io_bursts',
        includeProcessCapture: true,
        processTopX,
      })
      if (raw.length === 0) return null
      const summary = buildProcessSummary(raw as unknown as Telemetry[], allocation)
      return summary.length > 0 ? summary : null
    }

    function chartSeedForAllocation(
      allocation: Allocation,
      machine: Machine,
      profile: UsageProfile,
      overrides?: { pointCount?: number }
    ) {
      const startMs = allocation.startTime.toMillis()
      const endMs = allocation.endTime.toMillis()
      const durationMs = endMs - startMs
      const bucketMs = resolveChartBucketMs(durationMs)
      const pointCount =
        overrides?.pointCount ?? Math.max(2, Math.ceil(durationMs / bucketMs))
      const hw = hwFor(machine)
      return {
        chartSeries: generateChartSeriesWire(startMs, endMs, {
          pointCount,
          profile,
          ...hw,
          includeNetwork: profile === 'io_bursts',
        }),
        chartBucketMinutes: chartBucketMinutes(bucketMs),
      }
    }

    type AllocationSeed = {
      userId: number
      machineName: string
      startTime: DateTime
      endTime: DateTime
      reason: string
      status: 'finished' | 'approved' | 'pending' | 'cancelled'
      profile?: UsageProfile
      withMetrics?: boolean
    }

    const allocationsData: AllocationSeed[] = [
      // —— Concluídas com resumo pré-gerado ——
      {
        userId: 3,
        machineName: 'Euler',
        startTime: at(today.minus({ days: 28 }), 8),
        endTime: at(today.minus({ days: 14 }), 22),
        reason: 'Treino CUDA — corpus de vídeo UFPel (RTX A6000, 2 semanas)',
        status: 'finished',
        profile: 'training_burst',
        withMetrics: true,
      },
      {
        userId: 4,
        machineName: 'Arendt',
        startTime: at(today.minus({ days: 21 }), 9),
        endTime: at(today.minus({ days: 7 }), 20),
        reason: 'Fine-tuning diffusion — RTX 4090 D (2 semanas)',
        status: 'finished',
        profile: 'inference_gaps',
        withMetrics: true,
      },
      {
        userId: 5,
        machineName: 'GaciG6',
        startTime: at(today.minus({ days: 35 }), 8),
        endTime: at(today.minus({ days: 8 }), 18),
        reason: 'Pipeline batch FFmpeg + pré-processamento (servidor CPU, 4 semanas)',
        status: 'finished',
        profile: 'cpu_batch',
        withMetrics: true,
      },
      {
        userId: 6,
        machineName: 'GaciG1',
        startTime: at(today.minus({ days: 10 }), 10),
        endTime: at(today.minus({ days: 10 }), 11, 30),
        reason: 'Smoke test de ambiente SSH (Xeon, sem GPU)',
        status: 'finished',
        profile: 'compile_spikes',
        withMetrics: true,
      },

      // —— Ativas / futuras ——
      {
        userId: 3,
        machineName: 'Euler',
        startTime: at(today.minus({ days: 1 }), 14),
        endTime: at(today.plus({ days: 6 }), 18),
        reason: 'Simulação CUDA contínua — `ssh -p 50000 user@euler.lab.local`',
        status: 'approved',
        profile: 'training_burst',
      },
      {
        userId: 3,
        machineName: 'Arendt',
        startTime: at(today, 9),
        endTime: at(today.plus({ days: 5 }), 21),
        reason: 'RTX 4090 D — experimentos de inferência (`ssh -p 50000`)',
        status: 'approved',
        profile: 'inference_gaps',
      },
      {
        userId: 3,
        machineName: 'GaciG2',
        startTime: at(today.plus({ days: 2 }), 10),
        endTime: at(today.plus({ days: 3 }), 16),
        reason: 'Compilação paralela — cluster CPU GaciG2',
        status: 'approved',
        profile: 'compile_spikes',
      },
      {
        userId: 4,
        machineName: 'Dijkstra',
        startTime: at(today.minus({ days: 4 }), 9),
        endTime: at(today.plus({ days: 10 }), 20),
        reason: 'Benchmark RTX 4070 Ti — treino com picos e pausas',
        status: 'approved',
        profile: 'training_burst',
      },
      {
        userId: 5,
        machineName: 'GaciG4',
        startTime: at(today.minus({ days: 2 }), 14),
        endTime: at(today.plus({ days: 12 }), 23),
        reason: 'ETL de datasets — I/O intenso intermitente (96 GB RAM)',
        status: 'approved',
        profile: 'io_bursts',
      },
      {
        userId: 6,
        machineName: 'Arendt',
        startTime: at(today.plus({ days: 6 }), 8),
        endTime: at(today.plus({ days: 24 }), 20),
        reason: 'Reserva longa — diffusion vídeo na RTX 4090 D',
        status: 'approved',
        profile: 'training_burst',
      },
      {
        userId: 7,
        machineName: 'Moore',
        startTime: at(today.plus({ days: 7 }), 8),
        endTime: at(today.plus({ days: 28 }), 18),
        reason: 'Simulação CUDA — NVIDIA TITAN (AnyDesk, aguardando aprovação)',
        status: 'pending',
        profile: 'training_burst',
      },
      {
        userId: 8,
        machineName: 'GaciG7',
        startTime: at(today.plus({ days: 14 }), 10),
        endTime: at(today.plus({ days: 21 }), 18),
        reason: 'Processamento numérico CPU — 1 semana',
        status: 'approved',
        profile: 'cpu_batch',
      },

      // —— TEST Gabriel: gerar resumo na hora (sem allocation_metrics) ——
      {
        userId: 3,
        machineName: 'Euler',
        startTime: at(today.minus({ days: 1 }), 14, 0),
        endTime: at(today.minus({ days: 1 }), 14, 45),
        reason: '[TEST-A] Curta GPU · eco ~60s · <100 amostras · Gerar resumo',
        status: 'finished',
        profile: 'inference_gaps',
      },
      {
        userId: 3,
        machineName: 'GaciG3',
        startTime: at(today.minus({ days: 3 }), 9),
        endTime: at(today.minus({ days: 3 }), 17),
        reason: '[TEST-B] Média 8h CPU · fast ~30s · Gerar resumo',
        status: 'finished',
        profile: 'cpu_batch',
      },
      {
        userId: 3,
        machineName: 'Arendt',
        startTime: at(today.minus({ days: 6 }), 8),
        endTime: at(today.minus({ days: 3 }), 20),
        reason: '[TEST-C] Longa 3d GPU · custom 300s · Gerar resumo',
        status: 'finished',
        profile: 'training_burst',
      },
      {
        userId: 3,
        machineName: 'GaciG8',
        startTime: at(today.minus({ days: 9 }), 8),
        endTime: at(today.minus({ days: 8 }), 8),
        reason: '[TEST-D] Longa 24h CPU · fast ~15s · bruta densa · Gerar resumo',
        status: 'finished',
        profile: 'io_bursts',
      },
      {
        userId: 3,
        machineName: 'Confúcio',
        startTime: at(today.minus({ days: 1 }), 16, 0),
        endTime: at(today.minus({ days: 1 }), 16, 20),
        reason: `[TEST-E] Curta 20min GPU · fast ~10s · top ${TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX} proc · Gerar resumo`,
        status: 'finished',
        profile: 'inference_gaps',
      },
      {
        userId: 3,
        machineName: 'Dijkstra',
        startTime: at(today.minus({ days: 5 }), 8),
        endTime: at(today.minus({ days: 5 }), 9),
        reason: '[TEST-F] 1h GPU · eco @2s (projeção 24h no seed) · Gerar resumo',
        status: 'finished',
        profile: 'training_burst',
      },
      {
        userId: 3,
        machineName: 'Moore',
        startTime: at(today.minus({ days: 5 }), 10),
        endTime: at(today.minus({ days: 5 }), 11),
        reason: '[TEST-G] 1h GPU · fast @2s (projeção 24h no seed) · Gerar resumo',
        status: 'finished',
        profile: 'training_burst',
      },
      {
        userId: 3,
        machineName: 'Euler',
        startTime: at(today.minus({ days: 5 }), 12),
        endTime: at(today.minus({ days: 5 }), 13),
        reason: `[TEST-H] 1h GPU · custom todas métricas @2s · top ${TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX} proc · Gerar resumo`,
        status: 'finished',
        profile: 'training_burst',
      },

      // —— Cancelada ——
      {
        userId: 4,
        machineName: 'GaciS1',
        startTime: at(today.minus({ days: 40 }), 8),
        endTime: at(today.minus({ days: 33 }), 18),
        reason: 'Reserva semanal cancelada — servidor legado indisponível',
        status: 'cancelled',
        profile: 'cpu_batch',
      },
    ]

    const allocations: Allocation[] = []
    for (const row of allocationsData) {
      const { machineName, profile: _p, withMetrics: _w, ...data } = row
      allocations.push(
        await Allocation.create({
          userId: data.userId,
          machineId: mid(machineName).id,
          startTime: data.startTime,
          endTime: data.endTime,
          reason: data.reason,
          status: data.status,
        })
      )
    }

    const metricsRows: Parameters<typeof AllocationMetric.create>[0][] = []

    for (let i = 0; i < allocationsData.length; i++) {
      const seed = allocationsData[i]
      if (!seed.withMetrics) continue

      const allocation = allocations[i]
      const machine = mid(seed.machineName)
      const chart = chartSeedForAllocation(
        allocation,
        machine,
        seed.profile ?? 'training_burst'
      )
      const agg = aggregateWireMetricsFromChart(chart.chartSeries)
      if (!agg) continue

      const durationMin = Math.round(
        (allocation.endTime.toMillis() - allocation.startTime.toMillis()) / 60_000
      )
      const processSummary = processSummaryForAllocation(
        allocation,
        machine,
        seed.profile ?? 'training_burst',
        seed.machineName === 'Euler' ? TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX : 10
      )

      metricsRows.push({
        allocationId: allocation.id,
        ...agg,
        sessionDurationMinutes: durationMin,
        chartBucketMinutes: chart.chartBucketMinutes,
        chartSeries: chart.chartSeries,
        processSummary: processSummary as unknown as Record<string, unknown>[] | null,
      })
    }

    for (const m of metricsRows) {
      await AllocationMetric.create(m)
    }

    const summaryTestCases: {
      allocation: Allocation
      machine: Machine
      intervalMs: number
      label: string
      profile: UsageProfile
      processTopX?: number
      telemetrySet?: import('#services/telemetry/presets').TelemetrySetConfig
    }[] = [
      {
        allocation: allocations[12],
        machine: mid('Euler'),
        intervalMs: 60_000,
        label: 'TEST-A',
        profile: 'inference_gaps',
      },
      {
        allocation: allocations[13],
        machine: mid('GaciG3'),
        intervalMs: 30_000,
        label: 'TEST-B',
        profile: 'cpu_batch',
      },
      {
        allocation: allocations[14],
        machine: mid('Arendt'),
        intervalMs: 300_000,
        label: 'TEST-C',
        profile: 'training_burst',
      },
      {
        allocation: allocations[15],
        machine: mid('GaciG8'),
        intervalMs: 15_000,
        label: 'TEST-D',
        profile: 'io_bursts',
      },
      {
        allocation: allocations[16],
        machine: mid('Confúcio'),
        intervalMs: 10_000,
        label: 'TEST-E',
        profile: 'inference_gaps',
        processTopX: TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
      },
      {
        allocation: allocations[17],
        machine: mid('Dijkstra'),
        intervalMs: 2_000,
        label: 'TEST-F',
        profile: 'training_burst',
        telemetrySet: DEFAULT_LAB_TELEMETRY_PRESETS.eco.telemetrySet,
      },
      {
        allocation: allocations[18],
        machine: mid('Moore'),
        intervalMs: 2_000,
        label: 'TEST-G',
        profile: 'training_burst',
        telemetrySet: DEFAULT_LAB_TELEMETRY_PRESETS.fast.telemetrySet,
      },
      {
        allocation: allocations[19],
        machine: mid('Euler'),
        intervalMs: 2_000,
        label: 'TEST-H',
        profile: 'training_burst',
        telemetrySet: { ...FULL_TELEMETRY_SET, processCapture: true },
        processTopX: TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
      },
    ]

    console.log('\n📊 Alocações para gerar resumo (admin → Gerar resumo):')
    for (const test of summaryTestCases) {
      const hw = hwFor(test.machine)
      const startMs = test.allocation.startTime.toMillis()
      const endMs = test.allocation.endTime.toMillis()
      const rows = generateRawTelemetriesWire(
        test.allocation.id,
        startMs,
        endMs,
        test.intervalMs,
        {
          profile: test.profile,
          ...hw,
          includeDiskIo: test.profile === 'io_bursts' || test.telemetrySet?.disk === true,
          includeProcessCapture: test.telemetrySet?.processCapture ?? true,
          processTopX: test.processTopX ?? 12,
          telemetrySet: test.telemetrySet,
        }
      )
      await createTelemetriesInChunks((chunk) => Telemetry.createMany(chunk), rows)
      const durationMin = Math.round((endMs - startMs) / 60_000)
      const procLabel =
        test.processTopX != null
          ? `top ${test.processTopX}`
          : test.telemetrySet?.processCapture
            ? 'proc ✓'
            : 'proc —'
      console.log(
        `   ${test.label} · alocação #${test.allocation.id} · ${rows.length} brutas · ${durationMin} min · intervalo ${test.intervalMs / 1000}s · ${procLabel}`
      )
      console.log(`      → ${test.allocation.reason}`)
    }

    const preSummarized = allocationsData
      .map((s, i) => (s.withMetrics ? allocations[i].id : null))
      .filter(Boolean)
    console.log(`   Pré-resumidas (~100 pts + processSummary): alocações #${preSummarized.join(', #')}\n`)

    const euler = mid('Euler')
    const arendt = mid('Arendt')
    const gaciG2 = mid('GaciG2')
    const dijkstra = mid('Dijkstra')
    const gaciG3 = mid('GaciG3')

    const sshData = [
      {
        machineId: euler.id,
        sourceIp: '118.25.100.12',
        targetUsername: 'root',
        status: 'failed' as const,
        authMethod: 'password',
        createdAt: DateTime.now().minus({ hours: 5 }),
      },
      {
        machineId: euler.id,
        sourceIp: '192.168.8.55',
        targetUsername: 'lab.gabriel_santos',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey1',
        createdAt: DateTime.now().minus({ hours: 2 }),
      },
      {
        machineId: arendt.id,
        sourceIp: '192.168.8.55',
        targetUsername: 'lab.gabriel_santos',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey1',
        createdAt: DateTime.now().minus({ minutes: 90 }),
      },
      {
        machineId: dijkstra.id,
        sourceIp: '192.168.8.55',
        targetUsername: 'lab.gabriel_santos',
        status: 'success' as const,
        authMethod: 'publickey',
        clientFingerprint: 'SHA256:IPfakeUserKey1',
        createdAt: DateTime.now().minus({ minutes: 45 }),
      },
      {
        machineId: gaciG2.id,
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
        message: 'Sua reserva de 2 semanas em Euler (RTX A6000) está ativa.',
        isRead: false,
      },
      {
        userId: 3,
        title: 'Conectar em Arendt',
        message:
          'Reserva ativa na RTX 4090 D. Use `ssh -p 50000` e confira o host fingerprint no painel.',
        isRead: false,
      },
      {
        userId: 3,
        title: 'ETL — GaciG4',
        message: 'SSH na porta 50000. Picos de I/O aparecem no gráfico da sessão.',
        isRead: true,
        readAt: DateTime.now().minus({ hours: 3 }),
      },
      {
        userId: 5,
        title: 'GaciG6 — segunda reserva',
        message: 'Pipeline batch CPU aprovado (sem métricas de GPU).',
        isRead: true,
        readAt: DateTime.now().minus({ days: 1 }),
      },
      {
        userId: 7,
        title: 'Reserva pendente',
        message: 'Aguardando aprovação da simulação CUDA em Moore (AnyDesk).',
        isRead: false,
      },
      {
        userId: 1,
        title: 'SSH — tentativas bloqueadas',
        message: 'Falhas de login em Euler.',
        isRead: false,
      },
    ]

    for (const n of notifData) {
      await Notification.create(n)
    }

    const testBGaciG3 = summaryTestCases.find((t) => t.label === 'TEST-B')!

    const liveEntries: LiveTelemetrySeedEntry[] = [
      {
        machineId: euler.id,
        allocationId: allocations[4].id,
        hasGpu: true,
        ramTotalGbWire: euler.totalRamGb ?? 960,
        vramTotalGbWire: euler.totalVramGb,
        profile: 'training_burst',
        intervalSeconds: 5,
        sampleCount: 15,
        mode: 'active',
        includeProcessCapture: true,
        processTopX: TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
      },
      {
        machineId: arendt.id,
        allocationId: allocations[5].id,
        hasGpu: true,
        ramTotalGbWire: arendt.totalRamGb ?? 480,
        vramTotalGbWire: arendt.totalVramGb,
        profile: 'inference_gaps',
        intervalSeconds: 5,
        sampleCount: 15,
        mode: 'active',
        includeProcessCapture: true,
        processTopX: 10,
      },
      {
        machineId: dijkstra.id,
        allocationId: allocations[7].id,
        hasGpu: true,
        ramTotalGbWire: dijkstra.totalRamGb ?? 320,
        vramTotalGbWire: dijkstra.totalVramGb,
        profile: 'training_burst',
        intervalSeconds: 10,
        sampleCount: 12,
        mode: 'active',
        includeProcessCapture: true,
        processTopX: TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
      },
      {
        machineId: gaciG3.id,
        allocationId: testBGaciG3.allocation.id,
        hasGpu: false,
        ramTotalGbWire: gaciG3.totalRamGb ?? 480,
        profile: 'cpu_batch',
        intervalSeconds: 60,
        sampleCount: 24,
        mode: 'idle',
        includeProcessCapture: true,
        processTopX: TELEMETRY_PROCESS_CAPTURE_TOP_X_MAX,
      },
    ]

    writeLiveTelemetrySeedFile(liveEntries)

    logTelemetryStorageReport()

    const scenario24h = build24hTwoSecondScenarios()
    console.log('   Amostras reais 1h @ 2s (×24 ≈ projeção 24h):')
    for (const [idx, scenario] of scenario24h.entries()) {
      const testAlloc = summaryTestCases.find((t) => t.label === `TEST-${String.fromCharCode(70 + idx)}`)
      if (!testAlloc) continue
      const oneHourRows = generateStorageScenarioSamples(
        scenario,
        testAlloc.allocation.id,
        testAlloc.allocation.startTime.toMillis(),
        HOUR_MS
      )
      console.log(
        `   ${scenario.id}: ${oneHourRows.length} linhas/1h · linha ~${Math.round(oneHourRows[0] ? JSON.stringify(oneHourRows[0]).length : 0)} B JSON`
      )
    }

    console.log('✅ Seed de alocações concluído (live telemetry → storage/lab/live_telemetry_seed.json).\n')
}
