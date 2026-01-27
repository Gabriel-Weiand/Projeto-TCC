import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Allocation from '#models/allocation'
import { DateTime } from 'luxon'

export default class extends BaseSeeder {
  async run() {
    const now = DateTime.now()

    await Allocation.createMany([
      // Alocações passadas (finalizadas)
      {
        userId: 3, // Gabriel Santos
        machineId: 1, // PC-LAB-01
        startTime: now.minus({ days: 5, hours: 10 }),
        endTime: now.minus({ days: 5, hours: 6 }),
        reason: 'Treinamento de modelo de ML para TCC',
        status: 'finished',
      },
      {
        userId: 4, // Maria Oliveira
        machineId: 2, // PC-LAB-02
        startTime: now.minus({ days: 3, hours: 8 }),
        endTime: now.minus({ days: 3, hours: 4 }),
        reason: 'Renderização de cenas 3D',
        status: 'finished',
      },
      // Alocação cancelada
      {
        userId: 5, // João Pereira
        machineId: 3, // PC-LAB-03
        startTime: now.minus({ days: 2, hours: 6 }),
        endTime: now.minus({ days: 2, hours: 2 }),
        reason: 'Compilação de projeto',
        status: 'cancelled',
      },
      // Alocações de hoje (em andamento)
      {
        userId: 3, // Gabriel Santos
        machineId: 1, // PC-LAB-01
        startTime: now.minus({ hours: 2 }),
        endTime: now.plus({ hours: 2 }),
        reason: 'Continuação do treinamento de ML',
        status: 'approved',
      },
      {
        userId: 6, // Ana Costa
        machineId: 4, // PC-LAB-04
        startTime: now.minus({ hours: 1 }),
        endTime: now.plus({ hours: 3 }),
        reason: 'Desenvolvimento de aplicação web',
        status: 'approved',
      },
      // Alocações futuras (agendadas)
      {
        userId: 4, // Maria Oliveira
        machineId: 1, // PC-LAB-01
        startTime: now.plus({ days: 1, hours: 8 }),
        endTime: now.plus({ days: 1, hours: 12 }),
        reason: 'Treinamento de rede neural',
        status: 'approved',
      },
      {
        userId: 5, // João Pereira
        machineId: 2, // PC-LAB-02
        startTime: now.plus({ days: 1, hours: 14 }),
        endTime: now.plus({ days: 1, hours: 18 }),
        reason: 'Renderização de animação',
        status: 'approved',
      },
      {
        userId: 3, // Gabriel Santos
        machineId: 3, // PC-LAB-03
        startTime: now.plus({ days: 2, hours: 9 }),
        endTime: now.plus({ days: 2, hours: 17 }),
        reason: 'Build completo do projeto',
        status: 'approved',
      },
    ])
  }
}