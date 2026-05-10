import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import { DateTime } from 'luxon'

export default class extends BaseSeeder {
  static environment = ['via_index']

  async run() {
    const LAB_TZ = 'America/Sao_Paulo'
    const today = DateTime.now().setZone(LAB_TZ).startOf('day')

    function labTime(base: DateTime, hour: number, minute: number = 0): DateTime {
      return base.set({ hour, minute }).toUTC()
    }

    const allocations = await Allocation.createMany([

      // ---- FINALIZADAS (15) ----

      // [0] Gabriel — PC-LAB-01 — 5 dias — LLM fase 1
      {
        userId: 3, machineId: 1,
        startTime: labTime(today.minus({ days: 35 }), 8),
        endTime:   labTime(today.minus({ days: 30 }), 22),
        reason: 'Fine-tuning LLM — Fase 1 (treinamento base GPT-2 domain)',
        status: 'finished',
      },
      // [1] Maria — PC-LAB-02 — 5 dias — Renderização 3D
      {
        userId: 4, machineId: 2,
        startTime: labTime(today.minus({ days: 33 }), 8),
        endTime:   labTime(today.minus({ days: 28 }), 22),
        reason: 'Renderização 3D — Projeto de Arquitetura Final (Blender Cycles)',
        status: 'finished',
      },
      // [2] João — PC-LAB-03 — 5 dias — CFD
      {
        userId: 5, machineId: 3,
        startTime: labTime(today.minus({ days: 30 }), 8),
        endTime:   labTime(today.minus({ days: 25 }), 22),
        reason: 'Simulação CFD — Dinâmica de Fluidos Computacional (OpenFOAM Re=10⁴)',
        status: 'finished',
      },
      // [3] Ana — PC-LAB-07 — 4 dias — Genômica
      {
        userId: 6, machineId: 7,
        startTime: labTime(today.minus({ days: 28 }), 8),
        endTime:   labTime(today.minus({ days: 24 }), 22),
        reason: 'Processamento Dataset Genômico — Alinhamento BWA + Variant Calling',
        status: 'finished',
      },
      // [4] Carlos — PC-LAB-08 — 5 dias — Monte Carlo
      {
        userId: 7, machineId: 8,
        startTime: labTime(today.minus({ days: 26 }), 8),
        endTime:   labTime(today.minus({ days: 21 }), 22),
        reason: 'Simulação Monte Carlo — Física Nuclear (10⁸ eventos)',
        status: 'finished',
      },
      // [5] Fernanda — PC-LAB-06 — 4 dias — YOLOv8
      {
        userId: 8, machineId: 6,
        startTime: labTime(today.minus({ days: 24 }), 8),
        endTime:   labTime(today.minus({ days: 20 }), 22),
        reason: 'Treinamento YOLOv8 — Dataset Médico (detecção de tumores)',
        status: 'finished',
      },
      // [6] Rafael — PC-LAB-09 — mesmo dia (4h) — compilação
      {
        userId: 9, machineId: 9,
        startTime: labTime(today.minus({ days: 22 }), 9),
        endTime:   labTime(today.minus({ days: 22 }), 13),
        reason: 'Compilação e benchmark de pipeline de análise de dados',
        status: 'finished',
      },
      // [7] Beatriz — PC-LAB-04 — 4 dias — ERA5
      {
        userId: 10, machineId: 4,
        startTime: labTime(today.minus({ days: 21 }), 8),
        endTime:   labTime(today.minus({ days: 17 }), 22),
        reason: 'Análise estatística de dados climáticos — R + Python (ERA5)',
        status: 'finished',
      },
      // [8] Gabriel — PC-LAB-02 — 5 dias — LLM fase 2
      {
        userId: 3, machineId: 2,
        startTime: labTime(today.minus({ days: 19 }), 8),
        endTime:   labTime(today.minus({ days: 14 }), 22),
        reason: 'Fine-tuning LLM — Fase 2 (domain adaptation + RLHF)',
        status: 'finished',
      },
      // [9] Maria — PC-LAB-01 — 4 dias — segmentação semântica
      {
        userId: 4, machineId: 1,
        startTime: labTime(today.minus({ days: 18 }), 8),
        endTime:   labTime(today.minus({ days: 14 }), 22),
        reason: 'Fine-tuning Visão Computacional — Segmentação Semântica U-Net',
        status: 'finished',
      },
      // [10] Lucas — PC-LAB-04 — mesmo dia (3h) — teste ML
      {
        userId: 11, machineId: 4,
        startTime: labTime(today.minus({ days: 17 }), 10),
        endTime:   labTime(today.minus({ days: 17 }), 13),
        reason: 'Teste de pipeline ML — validação de ambiente e dependências',
        status: 'finished',
      },
      // [11] João — PC-LAB-03 — 4 dias — LLVM
      {
        userId: 5, machineId: 3,
        startTime: labTime(today.minus({ days: 15 }), 8),
        endTime:   labTime(today.minus({ days: 11 }), 22),
        reason: 'Benchmark LLVM + Build Completo do Compilador Customizado',
        status: 'finished',
      },
      // [12] Ana — PC-LAB-07 — 5 dias — GROMACS
      {
        userId: 6, machineId: 7,
        startTime: labTime(today.minus({ days: 13 }), 8),
        endTime:   labTime(today.minus({ days: 8 }), 22),
        reason: 'Simulação Dinâmica Molecular — GROMACS 2024 (membrana lipídica)',
        status: 'finished',
      },
      // [13] Camila — PC-LAB-08 — 4 dias — ResNet-50
      {
        userId: 12, machineId: 8,
        startTime: labTime(today.minus({ days: 11 }), 8),
        endTime:   labTime(today.minus({ days: 7 }), 22),
        reason: 'Treinamento ResNet-50 — Classificação de Doenças em Lavouras',
        status: 'finished',
      },
      // [14] Pedro — PC-LAB-06 — mesmo dia (4h) — STAR
      {
        userId: 13, machineId: 6,
        startTime: labTime(today.minus({ days: 9 }), 14),
        endTime:   labTime(today.minus({ days: 9 }), 18),
        reason: 'Análise rápida bioinformática — alinhamento de reads (STAR)',
        status: 'finished',
      },

      // ---- CANCELADAS / NEGADAS (6) ----

      // [15]
      {
        userId: 5, machineId: 3,
        startTime: labTime(today.minus({ days: 6 }), 8),
        endTime:   labTime(today.minus({ days: 4 }), 22),
        reason: 'Segunda rodada CFD — cancelado por mudança de parâmetros',
        status: 'cancelled',
      },
      // [16]
      {
        userId: 4, machineId: 1,
        startTime: labTime(today.minus({ days: 5 }), 8),
        endTime:   labTime(today.minus({ days: 4 }), 22),
        reason: 'Processamento batch de dados — excedeu cota semanal',
        status: 'denied',
      },
      // [17]
      {
        userId: 6, machineId: 2,
        startTime: labTime(today.minus({ days: 5 }), 8),
        endTime:   labTime(today.minus({ days: 4 }), 22),
        reason: 'Reserva cancelada — escopo do experimento redefinido',
        status: 'cancelled',
      },
      // [18]
      {
        userId: 3, machineId: 6,
        startTime: labTime(today.minus({ days: 4 }), 8),
        endTime:   labTime(today.minus({ days: 3 }), 22),
        reason: 'Sessão cancelada — conflito de agenda com orientador',
        status: 'cancelled',
      },
      // [19]
      {
        userId: 8, machineId: 9,
        startTime: labTime(today.minus({ days: 4 }), 9),
        endTime:   labTime(today.minus({ days: 4 }), 17),
        reason: 'Análise de imagens médicas — recurso indisponível no momento',
        status: 'denied',
      },
      // [20]
      {
        userId: 7, machineId: 4,
        startTime: labTime(today.minus({ days: 3 }), 8),
        endTime:   labTime(today.minus({ days: 2 }), 22),
        reason: 'Simulação de partículas — cancelado aguardando novos dados',
        status: 'cancelled',
      },

      // ---- ATIVAS HOJE (5) ----

      // [21] Gabriel — PC-LAB-01 — 3 dias
      {
        userId: 3, machineId: 1,
        startTime: labTime(today, 8),
        endTime:   labTime(today.plus({ days: 2 }), 22),
        reason: 'Rodada Final TCC — Experimentos de Avaliação (ablation study)',
        status: 'approved',
      },
      // [22] Ana — PC-LAB-04 — 4 dias
      {
        userId: 6, machineId: 4,
        startTime: labTime(today, 8),
        endTime:   labTime(today.plus({ days: 3 }), 22),
        reason: 'Simulação Monte Carlo — Física Computacional (10⁹ amostras)',
        status: 'approved',
      },
      // [23] João — PC-LAB-02 — 2 dias
      {
        userId: 5, machineId: 2,
        startTime: labTime(today, 8),
        endTime:   labTime(today.plus({ days: 1 }), 22),
        reason: 'Compilação e Testes de Sistema Distribuído (Kubernetes)',
        status: 'approved',
      },
      // [24] Maria — PC-LAB-06 — 3 dias
      {
        userId: 4, machineId: 6,
        startTime: labTime(today, 8),
        endTime:   labTime(today.plus({ days: 2 }), 22),
        reason: 'Pré-processamento Imagens Médicas DICOM — Augmentação de dados',
        status: 'approved',
      },
      // [25] Rafael — PC-LAB-09 — mesmo dia (6h)
      {
        userId: 9, machineId: 9,
        startTime: labTime(today, 9),
        endTime:   labTime(today, 15),
        reason: 'Análise exploratória de dados — Pandas + Dask (dataset 50GB)',
        status: 'approved',
      },

      // ---- FUTURAS APROVADAS (10) ----

      // [26] Maria — PC-LAB-01 — 5 dias
      {
        userId: 4, machineId: 1,
        startTime: labTime(today.plus({ days: 4 }), 8),
        endTime:   labTime(today.plus({ days: 8 }), 22),
        reason: 'Treinamento LSTM — Predição de Séries Temporais (energia elétrica)',
        status: 'approved',
      },
      // [27] João — PC-LAB-03 — 5 dias
      {
        userId: 5, machineId: 3,
        startTime: labTime(today.plus({ days: 3 }), 8),
        endTime:   labTime(today.plus({ days: 7 }), 22),
        reason: 'Renderização Animação 3D Alta Fidelidade — Defesa de Dissertação',
        status: 'approved',
      },
      // [28] Gabriel — PC-LAB-04 — 5 dias
      {
        userId: 3, machineId: 4,
        startTime: labTime(today.plus({ days: 5 }), 8),
        endTime:   labTime(today.plus({ days: 9 }), 22),
        reason: 'Treino Modelo de Linguagem Customizado (domínio técnico)',
        status: 'approved',
      },
      // [29] Ana — PC-LAB-02 — 5 dias
      {
        userId: 6, machineId: 2,
        startTime: labTime(today.plus({ days: 6 }), 8),
        endTime:   labTime(today.plus({ days: 10 }), 22),
        reason: 'Sequenciamento Genômico — Análise de Variantes SNP/INDEL (WGS)',
        status: 'approved',
      },
      // [30] Carlos — PC-LAB-07 — 4 dias
      {
        userId: 7, machineId: 7,
        startTime: labTime(today.plus({ days: 4 }), 8),
        endTime:   labTime(today.plus({ days: 7 }), 22),
        reason: 'Simulação Magneto-Hidrodinâmica — código FLASH paralelo',
        status: 'approved',
      },
      // [31] Fernanda — PC-LAB-08 — 4 dias
      {
        userId: 8, machineId: 8,
        startTime: labTime(today.plus({ days: 5 }), 8),
        endTime:   labTime(today.plus({ days: 8 }), 22),
        reason: 'Pipeline Visão Computacional — Detecção e Segmentação (SAM)',
        status: 'approved',
      },
      // [32] Beatriz — PC-LAB-09 — 5 dias
      {
        userId: 10, machineId: 9,
        startTime: labTime(today.plus({ days: 7 }), 8),
        endTime:   labTime(today.plus({ days: 11 }), 22),
        reason: 'Benchmark HPC — Comparação CPU/GPU (HPL + STREAM)',
        status: 'approved',
      },
      // [33] Lucas — PC-LAB-06 — mesmo dia (5h)
      {
        userId: 11, machineId: 6,
        startTime: labTime(today.plus({ days: 3 }), 9),
        endTime:   labTime(today.plus({ days: 3 }), 14),
        reason: 'Reprodução de experimento — validação de resultados publicados',
        status: 'approved',
      },
      // [34] Camila — PC-LAB-04 — 5 dias
      {
        userId: 12, machineId: 4,
        startTime: labTime(today.plus({ days: 8 }), 8),
        endTime:   labTime(today.plus({ days: 12 }), 22),
        reason: 'Segmentação Imagens de Satélite — U-Net multibanda (Sentinel-2)',
        status: 'approved',
      },
      // [35] Pedro — PC-LAB-01 — 3 dias
      {
        userId: 13, machineId: 1,
        startTime: labTime(today.plus({ days: 10 }), 8),
        endTime:   labTime(today.plus({ days: 12 }), 22),
        reason: 'Treinamento de Embeddings — Bioinformática (proteínas AlphaFold2)',
        status: 'approved',
      },

      // ---- FUTURAS PENDENTES (10) ----

      // [36] Ana — PC-LAB-04 — 6 dias
      {
        userId: 6, machineId: 4,
        startTime: labTime(today.plus({ days: 13 }), 8),
        endTime:   labTime(today.plus({ days: 18 }), 22),
        reason: 'Simulações de Fluidos Turbulentos — OpenFOAM (Re=10⁶, 3D)',
        status: 'pending',
      },
      // [37] Gabriel — PC-LAB-02 — 6 dias
      {
        userId: 3, machineId: 2,
        startTime: labTime(today.plus({ days: 15 }), 8),
        endTime:   labTime(today.plus({ days: 20 }), 22),
        reason: 'Treinamento Final — Experimentos para Defesa do TCC (GPT-4 fine-tune)',
        status: 'pending',
      },
      // [38] Maria — PC-LAB-06 — 6 dias
      {
        userId: 4, machineId: 6,
        startTime: labTime(today.plus({ days: 16 }), 8),
        endTime:   labTime(today.plus({ days: 21 }), 22),
        reason: 'Processamento Imagens Satélite — Sentinel-2 (classificação por bioma)',
        status: 'pending',
      },
      // [39] João — PC-LAB-01 — 6 dias
      {
        userId: 5, machineId: 1,
        startTime: labTime(today.plus({ days: 18 }), 8),
        endTime:   labTime(today.plus({ days: 23 }), 22),
        reason: 'Comparação de Modelos de Linguagem — Benchmarking NLP multilingual',
        status: 'pending',
      },
      // [40] Carlos — PC-LAB-03 — 6 dias
      {
        userId: 7, machineId: 3,
        startTime: labTime(today.plus({ days: 14 }), 8),
        endTime:   labTime(today.plus({ days: 19 }), 22),
        reason: 'Simulação Magnetosfera — código BATSRUS (domínio 3D x 200 AU)',
        status: 'pending',
      },
      // [41] Fernanda — PC-LAB-07 — 6 dias
      {
        userId: 8, machineId: 7,
        startTime: labTime(today.plus({ days: 17 }), 8),
        endTime:   labTime(today.plus({ days: 22 }), 22),
        reason: 'Segmentação Tumoral 3D — nnU-Net v2 (dataset LiTS+KiTS)',
        status: 'pending',
      },
      // [42] Juliana — PC-LAB-08 — 5 dias
      {
        userId: 14, machineId: 8,
        startTime: labTime(today.plus({ days: 12 }), 8),
        endTime:   labTime(today.plus({ days: 16 }), 22),
        reason: 'Análise de Expressão Gênica — RNA-seq diferencial (DESeq2)',
        status: 'pending',
      },
      // [43] Thiago — PC-LAB-09 — 5 dias
      {
        userId: 15, machineId: 9,
        startTime: labTime(today.plus({ days: 13 }), 8),
        endTime:   labTime(today.plus({ days: 17 }), 22),
        reason: 'Síntese Neural de Áudio — VITS2 (clone de voz multilíngue)',
        status: 'pending',
      },
      // [44] Beatriz — PC-LAB-06 — 6 dias
      {
        userId: 10, machineId: 6,
        startTime: labTime(today.plus({ days: 20 }), 8),
        endTime:   labTime(today.plus({ days: 25 }), 22),
        reason: 'Simulação Dinâmica Molecular — GROMACS 2024 (folding proteico)',
        status: 'pending',
      },
      // [45] Lucas — PC-LAB-04 — 5 dias
      {
        userId: 11, machineId: 4,
        startTime: labTime(today.plus({ days: 22 }), 8),
        endTime:   labTime(today.plus({ days: 26 }), 22),
        reason: 'Treinamento Deep RL — PPO + SAC em ambiente customizado (RoboSuite)',
        status: 'pending',
      },
    ])

    // ---- MÉTRICAS para finalizadas (índices 0–14) ----
    await AllocationMetric.createMany([
      {
        allocationId: allocations[0].id,
        avgCpuUsage: 82.4, maxCpuUsage: 99.1, avgCpuTemp: 74.8, maxCpuTemp: 91.3,
        avgGpuUsage: 96.5, maxGpuUsage: 100.0, avgGpuTemp: 79.2, maxGpuTemp: 87.4,
        avgRamUsage: 74.6, maxRamUsage: 92.1, avgDiskUsage: 55.3, maxDiskUsage: 68.7,
        sessionDurationMinutes: 7200,
      },
      {
        allocationId: allocations[1].id,
        avgCpuUsage: 68.2, maxCpuUsage: 91.7, avgCpuTemp: 70.5, maxCpuTemp: 85.9,
        avgGpuUsage: 97.3, maxGpuUsage: 100.0, avgGpuTemp: 83.1, maxGpuTemp: 93.6,
        avgRamUsage: 75.8, maxRamUsage: 94.2, avgDiskUsage: 62.4, maxDiskUsage: 78.9,
        sessionDurationMinutes: 7200,
      },
      {
        allocationId: allocations[2].id,
        avgCpuUsage: 93.7, maxCpuUsage: 100.0, avgCpuTemp: 78.4, maxCpuTemp: 95.2,
        avgGpuUsage: 15.1, maxGpuUsage: 42.3, avgGpuTemp: 44.6, maxGpuTemp: 58.1,
        avgRamUsage: 88.4, maxRamUsage: 98.7, avgDiskUsage: 71.2, maxDiskUsage: 89.5,
        sessionDurationMinutes: 7200,
      },
      {
        allocationId: allocations[3].id,
        avgCpuUsage: 79.6, maxCpuUsage: 97.2, avgCpuTemp: 71.3, maxCpuTemp: 88.7,
        avgGpuUsage: 22.5, maxGpuUsage: 51.8, avgGpuTemp: 46.3, maxGpuTemp: 61.4,
        avgRamUsage: 87.3, maxRamUsage: 99.1, avgDiskUsage: 83.7, maxDiskUsage: 97.6,
        sessionDurationMinutes: 5760,
      },
      {
        allocationId: allocations[4].id,
        avgCpuUsage: 89.5, maxCpuUsage: 100.0, avgCpuTemp: 77.1, maxCpuTemp: 93.4,
        avgGpuUsage: 45.2, maxGpuUsage: 78.6, avgGpuTemp: 58.3, maxGpuTemp: 72.8,
        avgRamUsage: 61.4, maxRamUsage: 79.2, avgDiskUsage: 38.7, maxDiskUsage: 52.4,
        sessionDurationMinutes: 7200,
      },
      {
        allocationId: allocations[5].id,
        avgCpuUsage: 71.3, maxCpuUsage: 94.6, avgCpuTemp: 68.9, maxCpuTemp: 84.2,
        avgGpuUsage: 92.8, maxGpuUsage: 99.7, avgGpuTemp: 77.4, maxGpuTemp: 88.1,
        avgRamUsage: 68.5, maxRamUsage: 87.3, avgDiskUsage: 44.2, maxDiskUsage: 59.8,
        sessionDurationMinutes: 5760,
      },
      {
        allocationId: allocations[6].id,
        avgCpuUsage: 76.4, maxCpuUsage: 98.3, avgCpuTemp: 65.7, maxCpuTemp: 81.4,
        avgGpuUsage: 5.2, maxGpuUsage: 18.4, avgGpuTemp: 38.9, maxGpuTemp: 47.2,
        avgRamUsage: 42.1, maxRamUsage: 64.7, avgDiskUsage: 28.3, maxDiskUsage: 41.6,
        sessionDurationMinutes: 240,
      },
      {
        allocationId: allocations[7].id,
        avgCpuUsage: 74.2, maxCpuUsage: 96.8, avgCpuTemp: 69.4, maxCpuTemp: 85.6,
        avgGpuUsage: 31.7, maxGpuUsage: 62.4, avgGpuTemp: 52.1, maxGpuTemp: 66.9,
        avgRamUsage: 83.6, maxRamUsage: 97.4, avgDiskUsage: 76.8, maxDiskUsage: 94.2,
        sessionDurationMinutes: 5760,
      },
      {
        allocationId: allocations[8].id,
        avgCpuUsage: 85.1, maxCpuUsage: 99.6, avgCpuTemp: 76.2, maxCpuTemp: 93.4,
        avgGpuUsage: 98.2, maxGpuUsage: 100.0, avgGpuTemp: 81.5, maxGpuTemp: 89.8,
        avgRamUsage: 79.4, maxRamUsage: 95.3, avgDiskUsage: 58.1, maxDiskUsage: 73.6,
        sessionDurationMinutes: 7200,
      },
      {
        allocationId: allocations[9].id,
        avgCpuUsage: 77.6, maxCpuUsage: 97.8, avgCpuTemp: 72.1, maxCpuTemp: 87.5,
        avgGpuUsage: 91.8, maxGpuUsage: 99.4, avgGpuTemp: 76.9, maxGpuTemp: 85.3,
        avgRamUsage: 73.2, maxRamUsage: 91.7, avgDiskUsage: 47.8, maxDiskUsage: 60.4,
        sessionDurationMinutes: 5760,
      },
      {
        allocationId: allocations[10].id,
        avgCpuUsage: 52.3, maxCpuUsage: 88.1, avgCpuTemp: 58.4, maxCpuTemp: 74.7,
        avgGpuUsage: 67.4, maxGpuUsage: 94.2, avgGpuTemp: 62.8, maxGpuTemp: 78.3,
        avgRamUsage: 48.6, maxRamUsage: 71.4, avgDiskUsage: 22.1, maxDiskUsage: 34.8,
        sessionDurationMinutes: 180,
      },
      {
        allocationId: allocations[11].id,
        avgCpuUsage: 91.4, maxCpuUsage: 100.0, avgCpuTemp: 77.3, maxCpuTemp: 93.8,
        avgGpuUsage: 8.6, maxGpuUsage: 28.4, avgGpuTemp: 40.2, maxGpuTemp: 53.7,
        avgRamUsage: 64.9, maxRamUsage: 83.6, avgDiskUsage: 76.3, maxDiskUsage: 94.8,
        sessionDurationMinutes: 5760,
      },
      {
        allocationId: allocations[12].id,
        avgCpuUsage: 88.3, maxCpuUsage: 100.0, avgCpuTemp: 76.7, maxCpuTemp: 92.1,
        avgGpuUsage: 42.7, maxGpuUsage: 71.9, avgGpuTemp: 54.8, maxGpuTemp: 68.3,
        avgRamUsage: 82.6, maxRamUsage: 97.4, avgDiskUsage: 68.4, maxDiskUsage: 85.2,
        sessionDurationMinutes: 7200,
      },
      {
        allocationId: allocations[13].id,
        avgCpuUsage: 69.8, maxCpuUsage: 92.4, avgCpuTemp: 66.3, maxCpuTemp: 82.9,
        avgGpuUsage: 88.4, maxGpuUsage: 98.7, avgGpuTemp: 74.2, maxGpuTemp: 84.6,
        avgRamUsage: 71.7, maxRamUsage: 90.3, avgDiskUsage: 51.3, maxDiskUsage: 66.7,
        sessionDurationMinutes: 5760,
      },
      {
        allocationId: allocations[14].id,
        avgCpuUsage: 67.4, maxCpuUsage: 91.8, avgCpuTemp: 61.2, maxCpuTemp: 77.4,
        avgGpuUsage: 12.3, maxGpuUsage: 35.6, avgGpuTemp: 41.7, maxGpuTemp: 54.2,
        avgRamUsage: 59.3, maxRamUsage: 80.1, avgDiskUsage: 67.8, maxDiskUsage: 86.4,
        sessionDurationMinutes: 240,
      },
    ])

    console.log('\n📅 Alocações de laboratório criadas:')
    console.log(
      `   ${allocations.length} alocações — 15 finalizadas (mix multi-dia + curtas) com métricas,\n` +
      `   6 canceladas/negadas, 5 ativas hoje, 10 futuras aprovadas, 10 pendentes\n` +
      `   Usuários: 15 total (2 admins + 13 alunos) | Máquinas: 10 (PC-LAB-01 a PC-LAB-10)`
    )
  }
}
