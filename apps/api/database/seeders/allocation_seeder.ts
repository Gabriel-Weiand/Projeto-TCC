import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Allocation from '#models/allocation'
import AllocationMetric from '#models/allocation_metric'
import { DateTime } from 'luxon'

export default class extends BaseSeeder {
  static environment = ['via_index']

  async run() {
    // Horários das alocações são definidos em horário local do laboratório (Brasília).
    // O servidor opera em UTC (TZ=UTC), então convertemos para UTC com .toUTC().
    const LAB_TZ = 'America/Sao_Paulo'
    const today = DateTime.now().setZone(LAB_TZ).startOf('day')

    /**
     * Helper: cria DateTime em horário local do lab e converte para UTC.
     * Ex: labTime(today, 8, 0) → 8:00 Brasília = 11:00 UTC
     */
    function labTime(base: DateTime, hour: number, minute: number = 0): DateTime {
      return base.set({ hour, minute }).toUTC()
    }

    const allocations = await Allocation.createMany([
      // ============================
      // Alocações passadas finalizadas (com métricas)
      // ============================
      {
        userId: 3, // Gabriel Santos
        machineId: 1, // PC-LAB-01
        startTime: labTime(today.minus({ days: 12 }), 8, 0),
        endTime: labTime(today.minus({ days: 12 }), 12, 0),
        reason: 'Treinamento de modelo de ML para TCC',
        status: 'finished',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 2, // PC-LAB-02
        startTime: labTime(today.minus({ days: 11 }), 14, 0),
        endTime: labTime(today.minus({ days: 11 }), 18, 0),
        reason: 'Renderização de cenas 3D',
        status: 'finished',
      },
      {
        userId: 5, // João Pereira
        machineId: 3, // PC-LAB-03
        startTime: labTime(today.minus({ days: 10 }), 9, 0),
        endTime: labTime(today.minus({ days: 10 }), 17, 0),
        reason: 'Compilação de projeto open-source',
        status: 'finished',
      },
      {
        userId: 6, // Ana Costa
        machineId: 6, // PC-LAB-06
        startTime: labTime(today.minus({ days: 9 }), 13, 0),
        endTime: labTime(today.minus({ days: 9 }), 16, 30),
        reason: 'Processamento de dataset para TCC',
        status: 'finished',
      },
      {
        userId: 3, // Gabriel Santos
        machineId: 4, // PC-LAB-04
        startTime: labTime(today.minus({ days: 8 }), 10, 0),
        endTime: labTime(today.minus({ days: 8 }), 14, 0),
        reason: 'Testes de integração do sistema',
        status: 'finished',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 1, // PC-LAB-01
        startTime: labTime(today.minus({ days: 7 }), 8, 30),
        endTime: labTime(today.minus({ days: 7 }), 12, 30),
        reason: 'Ajuste fino de hiperparâmetros de CNN',
        status: 'finished',
      },
      {
        userId: 5, // João Pereira
        machineId: 2, // PC-LAB-02
        startTime: labTime(today.minus({ days: 6 }), 14, 0),
        endTime: labTime(today.minus({ days: 6 }), 18, 30),
        reason: 'Renderização de assets para apresentação',
        status: 'finished',
      },
      {
        userId: 6, // Ana Costa
        machineId: 3, // PC-LAB-03
        startTime: labTime(today.minus({ days: 5 }), 9, 0),
        endTime: labTime(today.minus({ days: 5 }), 12, 0),
        reason: 'Execução de simulações numéricas',
        status: 'finished',
      },
      {
        userId: 3, // Gabriel Santos
        machineId: 1, // PC-LAB-01
        startTime: labTime(today.minus({ days: 4 }), 13, 0),
        endTime: labTime(today.minus({ days: 4 }), 17, 0),
        reason: 'Treino incremental de modelo de classificação',
        status: 'finished',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 4, // PC-LAB-04
        startTime: labTime(today.minus({ days: 3 }), 10, 0),
        endTime: labTime(today.minus({ days: 3 }), 13, 30),
        reason: 'Validação de pipeline de visão computacional',
        status: 'finished',
      },

      // ============================
      // Alocação cancelada e negada
      // ============================
      {
        userId: 5, // João Pereira
        machineId: 3, // PC-LAB-03
        startTime: labTime(today.minus({ days: 2 }), 15, 0),
        endTime: labTime(today.minus({ days: 2 }), 19, 0),
        reason: 'Segunda compilação',
        status: 'cancelled',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 1, // PC-LAB-01
        startTime: labTime(today.minus({ days: 1 }), 8, 0),
        endTime: labTime(today.minus({ days: 1 }), 20, 0),
        reason: 'Uso prolongado para benchmark',
        status: 'denied',
      },
      {
        userId: 6, // Ana Costa
        machineId: 2, // PC-LAB-02
        startTime: labTime(today.minus({ days: 1 }), 18, 0),
        endTime: labTime(today.minus({ days: 1 }), 22, 0),
        reason: 'Reserva fora da janela do laboratório',
        status: 'denied',
      },
      {
        userId: 3, // Gabriel Santos
        machineId: 6, // PC-LAB-06
        startTime: labTime(today.minus({ days: 1 }), 15, 0),
        endTime: labTime(today.minus({ days: 1 }), 16, 30),
        reason: 'Cancelamento por mudança de prioridade',
        status: 'cancelled',
      },

      // ============================
      // Alocações de hoje (em andamento / aprovadas)
      // ============================
      {
        userId: 3, // Gabriel Santos
        machineId: 1, // PC-LAB-01
        startTime: labTime(today, 7, 0),
        endTime: labTime(today, 11, 0),
        reason: 'Continuação do treinamento de ML',
        status: 'approved',
      },
      {
        userId: 6, // Ana Costa
        machineId: 4, // PC-LAB-04
        startTime: labTime(today, 19, 0),
        endTime: labTime(today, 23, 0),
        reason: 'Desenvolvimento de aplicação web',
        status: 'approved',
      },
      {
        userId: 5, // João Pereira
        machineId: 2, // PC-LAB-02
        startTime: labTime(today, 16, 0),
        endTime: labTime(today, 20, 0),
        reason: 'Compilação de versão release',
        status: 'approved',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 6, // PC-LAB-06
        startTime: labTime(today, 18, 30),
        endTime: labTime(today, 21, 30),
        reason: 'Pré-processamento de imagens',
        status: 'approved',
      },

      // ============================
      // Alocações futuras aprovadas (para preencher calendário)
      // ============================
      {
        userId: 4, // Maria Oliveira
        machineId: 1, // PC-LAB-01
        startTime: labTime(today.plus({ days: 1 }), 8, 0),
        endTime: labTime(today.plus({ days: 1 }), 12, 0),
        reason: 'Treinamento de rede neural',
        status: 'approved',
      },
      {
        userId: 5, // João Pereira
        machineId: 2, // PC-LAB-02
        startTime: labTime(today.plus({ days: 1 }), 14, 0),
        endTime: labTime(today.plus({ days: 1 }), 18, 0),
        reason: 'Renderização de animação',
        status: 'approved',
      },
      {
        userId: 3, // Gabriel Santos
        machineId: 3, // PC-LAB-03
        startTime: labTime(today.plus({ days: 2 }), 9, 0),
        endTime: labTime(today.plus({ days: 2 }), 17, 0),
        reason: 'Build completo do projeto',
        status: 'approved',
      },
      {
        userId: 6, // Ana Costa
        machineId: 2, // PC-LAB-02
        startTime: labTime(today.plus({ days: 2 }), 8, 0),
        endTime: labTime(today.plus({ days: 2 }), 11, 0),
        reason: 'Análise de dados estatísticos',
        status: 'approved',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 4, // PC-LAB-04
        startTime: labTime(today.plus({ days: 3 }), 10, 0),
        endTime: labTime(today.plus({ days: 3 }), 15, 0),
        reason: 'Treinamento de modelo GAN',
        status: 'approved',
      },
      {
        userId: 5, // João Pereira
        machineId: 1, // PC-LAB-01
        startTime: labTime(today.plus({ days: 3 }), 16, 0),
        endTime: labTime(today.plus({ days: 3 }), 20, 0),
        reason: 'Benchmark GPU para dissertação',
        status: 'approved',
      },
      {
        userId: 6, // Ana Costa
        machineId: 6, // PC-LAB-06
        startTime: labTime(today.plus({ days: 4 }), 8, 30),
        endTime: labTime(today.plus({ days: 4 }), 12, 0),
        reason: 'Sessão de limpeza e validação de dados',
        status: 'approved',
      },
      {
        userId: 3, // Gabriel Santos
        machineId: 4, // PC-LAB-04
        startTime: labTime(today.plus({ days: 4 }), 13, 30),
        endTime: labTime(today.plus({ days: 4 }), 17, 30),
        reason: 'Testes de regressão da API',
        status: 'approved',
      },

      // ============================
      // Alocações pendentes (para admin aprovar/negar)
      // ============================
      {
        userId: 3, // Gabriel Santos
        machineId: 2, // PC-LAB-02
        startTime: labTime(today.plus({ days: 5 }), 9, 0),
        endTime: labTime(today.plus({ days: 5 }), 13, 0),
        reason: 'Exportação de resultados do TCC',
        status: 'pending',
      },
      {
        userId: 6, // Ana Costa
        machineId: 3, // PC-LAB-03
        startTime: labTime(today.plus({ days: 5 }), 14, 0),
        endTime: labTime(today.plus({ days: 5 }), 18, 0),
        reason: 'Simulação computacional',
        status: 'pending',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 6, // PC-LAB-06
        startTime: labTime(today.plus({ days: 6 }), 8, 0),
        endTime: labTime(today.plus({ days: 6 }), 12, 0),
        reason: 'Processamento de imagens médicas',
        status: 'pending',
      },
      {
        userId: 5, // João Pereira
        machineId: 1, // PC-LAB-01
        startTime: labTime(today.plus({ days: 6 }), 13, 0),
        endTime: labTime(today.plus({ days: 6 }), 17, 0),
        reason: 'Comparação de performance entre compiladores',
        status: 'pending',
      },
      {
        userId: 3, // Gabriel Santos
        machineId: 3, // PC-LAB-03
        startTime: labTime(today.plus({ days: 7 }), 9, 0),
        endTime: labTime(today.plus({ days: 7 }), 16, 0),
        reason: 'Treino final para entrega do TCC',
        status: 'pending',
      },
      {
        userId: 6, // Ana Costa
        machineId: 4, // PC-LAB-04
        startTime: labTime(today.plus({ days: 7 }), 16, 0),
        endTime: labTime(today.plus({ days: 7 }), 20, 0),
        reason: 'Sessão de integração com frontend',
        status: 'pending',
      },
    ])

    // ============================
    // Métricas para alocações finalizadas (IDs 1-10)
    // ============================
    await AllocationMetric.createMany([
      {
        allocationId: allocations[0].id, // Gabriel - ML Training
        avgCpuUsage: 78.5,
        maxCpuUsage: 98.2,
        avgCpuTemp: 72.3,
        maxCpuTemp: 89.1,
        avgGpuUsage: 92.1,
        maxGpuUsage: 99.8,
        avgGpuTemp: 76.4,
        maxGpuTemp: 84.2,
        avgRamUsage: 68.3,
        maxRamUsage: 87.9,
        avgDiskUsage: 45.2,
        maxDiskUsage: 52.1,
        sessionDurationMinutes: 240,
      },
      {
        allocationId: allocations[1].id, // Maria - 3D Rendering
        avgCpuUsage: 65.8,
        maxCpuUsage: 89.4,
        avgCpuTemp: 68.1,
        maxCpuTemp: 82.7,
        avgGpuUsage: 95.6,
        maxGpuUsage: 100.0,
        avgGpuTemp: 81.2,
        maxGpuTemp: 91.5,
        avgRamUsage: 72.4,
        maxRamUsage: 91.3,
        avgDiskUsage: 38.7,
        maxDiskUsage: 44.2,
        sessionDurationMinutes: 240,
      },
      {
        allocationId: allocations[2].id, // João - Compilação
        avgCpuUsage: 88.9,
        maxCpuUsage: 100.0,
        avgCpuTemp: 75.6,
        maxCpuTemp: 92.3,
        avgGpuUsage: 12.3,
        maxGpuUsage: 35.1,
        avgGpuTemp: 42.1,
        maxGpuTemp: 55.8,
        avgRamUsage: 55.7,
        maxRamUsage: 78.4,
        avgDiskUsage: 62.3,
        maxDiskUsage: 85.1,
        sessionDurationMinutes: 480,
      },
      {
        allocationId: allocations[3].id, // Ana - Dataset
        avgCpuUsage: 45.2,
        maxCpuUsage: 72.8,
        avgCpuTemp: 55.3,
        maxCpuTemp: 68.9,
        avgGpuUsage: 30.4,
        maxGpuUsage: 60.2,
        avgGpuTemp: 48.7,
        maxGpuTemp: 62.1,
        avgRamUsage: 80.1,
        maxRamUsage: 94.6,
        avgDiskUsage: 71.8,
        maxDiskUsage: 88.3,
        sessionDurationMinutes: 210,
      },
      {
        allocationId: allocations[4].id, // Gabriel - Testes
        avgCpuUsage: 35.6,
        maxCpuUsage: 58.3,
        avgCpuTemp: 48.2,
        maxCpuTemp: 62.4,
        avgGpuUsage: 8.2,
        maxGpuUsage: 22.1,
        avgGpuTemp: 38.5,
        maxGpuTemp: 45.2,
        avgRamUsage: 42.8,
        maxRamUsage: 63.1,
        avgDiskUsage: 25.4,
        maxDiskUsage: 38.7,
        sessionDurationMinutes: 240,
      },
      {
        allocationId: allocations[5].id, // Maria - CNN
        avgCpuUsage: 74.3,
        maxCpuUsage: 96.4,
        avgCpuTemp: 69.8,
        maxCpuTemp: 85.2,
        avgGpuUsage: 89.5,
        maxGpuUsage: 98.1,
        avgGpuTemp: 74.1,
        maxGpuTemp: 83.4,
        avgRamUsage: 70.2,
        maxRamUsage: 90.4,
        avgDiskUsage: 46.3,
        maxDiskUsage: 57.6,
        sessionDurationMinutes: 240,
      },
      {
        allocationId: allocations[6].id, // João - Assets
        avgCpuUsage: 62.7,
        maxCpuUsage: 86.9,
        avgCpuTemp: 66.2,
        maxCpuTemp: 80.8,
        avgGpuUsage: 91.2,
        maxGpuUsage: 99.6,
        avgGpuTemp: 79.4,
        maxGpuTemp: 88.7,
        avgRamUsage: 67.8,
        maxRamUsage: 84.9,
        avgDiskUsage: 40.5,
        maxDiskUsage: 49.2,
        sessionDurationMinutes: 270,
      },
      {
        allocationId: allocations[7].id, // Ana - Simulações
        avgCpuUsage: 81.4,
        maxCpuUsage: 97.6,
        avgCpuTemp: 73.2,
        maxCpuTemp: 88.9,
        avgGpuUsage: 35.8,
        maxGpuUsage: 61.7,
        avgGpuTemp: 50.4,
        maxGpuTemp: 64.1,
        avgRamUsage: 58.6,
        maxRamUsage: 75.2,
        avgDiskUsage: 63.9,
        maxDiskUsage: 79.8,
        sessionDurationMinutes: 180,
      },
      {
        allocationId: allocations[8].id, // Gabriel - Treino incremental
        avgCpuUsage: 76.9,
        maxCpuUsage: 94.2,
        avgCpuTemp: 70.1,
        maxCpuTemp: 86.5,
        avgGpuUsage: 87.3,
        maxGpuUsage: 97.7,
        avgGpuTemp: 73.5,
        maxGpuTemp: 82.8,
        avgRamUsage: 64.1,
        maxRamUsage: 83.6,
        avgDiskUsage: 44.8,
        maxDiskUsage: 55.3,
        sessionDurationMinutes: 240,
      },
      {
        allocationId: allocations[9].id, // Maria - Pipeline CV
        avgCpuUsage: 54.2,
        maxCpuUsage: 77.3,
        avgCpuTemp: 57.8,
        maxCpuTemp: 70.5,
        avgGpuUsage: 41.9,
        maxGpuUsage: 68.3,
        avgGpuTemp: 55.7,
        maxGpuTemp: 66.9,
        avgRamUsage: 60.5,
        maxRamUsage: 79.4,
        avgDiskUsage: 37.1,
        maxDiskUsage: 46.2,
        sessionDurationMinutes: 210,
      },
    ])

    console.log('\n📅 Alocações criadas:')
    console.log(
      `   ${allocations.length} alocações (10 finalizadas com métricas, 4 canceladas/negadas, 4 de hoje aprovadas, 8 futuras aprovadas, 6 pendentes)`
    )
  }
}
