import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Machine from '#models/machine'

export default class extends BaseSeeder {
  async run() {
    const machines = await Machine.createMany([
      // Máquinas de alto desempenho
      {
        name: 'PC-LAB-01',
        description: 'Workstation para Deep Learning',
        cpuModel: 'AMD Ryzen 9 5900X',
        gpuModel: 'NVIDIA RTX 3090',
        totalRamGb: 64,
        totalDiskGb: 2000,
        status: 'available',
      },
      {
        name: 'PC-LAB-02',
        description: 'Workstation para Renderização 3D',
        cpuModel: 'Intel Core i9-12900K',
        gpuModel: 'NVIDIA RTX 3080',
        totalRamGb: 32,
        totalDiskGb: 1000,
        status: 'available',
      },
      {
        name: 'PC-LAB-03',
        description: 'Servidor de Compilação',
        cpuModel: 'AMD Threadripper 3960X',
        gpuModel: 'NVIDIA RTX 3070',
        totalRamGb: 128,
        totalDiskGb: 4000,
        status: 'available',
      },
      // Máquinas de uso geral
      {
        name: 'PC-LAB-04',
        description: 'Desktop para desenvolvimento',
        cpuModel: 'Intel Core i7-12700K',
        gpuModel: 'NVIDIA RTX 3060',
        totalRamGb: 16,
        totalDiskGb: 512,
        status: 'available',
      },
      {
        name: 'PC-LAB-05',
        description: 'Desktop para desenvolvimento',
        cpuModel: 'Intel Core i7-12700K',
        gpuModel: 'NVIDIA RTX 3060',
        totalRamGb: 16,
        totalDiskGb: 512,
        status: 'maintenance', // Em manutenção para teste
      },
      {
        name: 'PC-LAB-06',
        description: 'Desktop para uso geral',
        cpuModel: 'AMD Ryzen 5 5600X',
        gpuModel: 'NVIDIA GTX 1660',
        totalRamGb: 16,
        totalDiskGb: 256,
        status: 'available',
      },
    ])

    // Exibe os tokens gerados para facilitar testes
    console.log('\n📟 Tokens das máquinas (salve para testes do Agent):')
    console.log('=' .repeat(80))
    for (const machine of machines) {
      console.log(`${machine.name}: ${machine.token}`)
    }
    console.log('=' .repeat(80) + '\n')
  }
}