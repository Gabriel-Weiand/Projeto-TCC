import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Machine from '#models/machine'

export default class extends BaseSeeder {
  static environment = ['via_index']

  async run() {
    const machines = await Machine.createMany([
      // --- Alto desempenho (GPU) ---
      {
        name: 'PC-LAB-01',
        description: 'Workstation Deep Learning — RTX 3090',
        cpuModel: 'AMD Ryzen 9 5900X',
        gpuModel: 'NVIDIA RTX 3090 24GB',
        totalRamGb: 64,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 2000, freeGb: null }]),
        status: 'available',
      },
      {
        name: 'PC-LAB-02',
        description: 'Workstation Renderização 3D — RTX 3080',
        cpuModel: 'Intel Core i9-12900K',
        gpuModel: 'NVIDIA RTX 3080 10GB',
        totalRamGb: 32,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 1000, freeGb: null }]),
        status: 'available',
      },
      {
        name: 'PC-LAB-03',
        description: 'Servidor de Compilação — Threadripper',
        cpuModel: 'AMD Threadripper 3960X (24 cores)',
        gpuModel: 'NVIDIA RTX 3070 8GB',
        totalRamGb: 128,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 4000, freeGb: null }]),
        status: 'available',
      },
      {
        name: 'PC-LAB-04',
        description: 'Workstation Simulação Numérica',
        cpuModel: 'Intel Core i9-11900K',
        gpuModel: 'NVIDIA RTX 3060 Ti 8GB',
        totalRamGb: 64,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 2000, freeGb: null }]),
        status: 'available',
      },
      // --- Manutenção ---
      {
        name: 'PC-LAB-05',
        description: 'Desktop — Em manutenção preventiva',
        cpuModel: 'Intel Core i7-12700K',
        gpuModel: 'NVIDIA RTX 3060 12GB',
        totalRamGb: 32,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 512, freeGb: null }]),
        status: 'maintenance',
      },
      // --- Uso geral ---
      {
        name: 'PC-LAB-06',
        description: 'Desktop Uso Geral — AMD',
        cpuModel: 'AMD Ryzen 7 5800X',
        gpuModel: 'NVIDIA GTX 1660 Super 6GB',
        totalRamGb: 32,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 1000, freeGb: null }]),
        status: 'available',
      },
      {
        name: 'PC-LAB-07',
        description: 'Workstation Bioinformática — RAM alta',
        cpuModel: 'AMD Ryzen 9 5950X (16 cores)',
        gpuModel: 'NVIDIA RTX 3060 12GB',
        totalRamGb: 128,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 4000, freeGb: null }]),
        status: 'available',
      },
      {
        name: 'PC-LAB-08',
        description: 'Workstation Visão Computacional',
        cpuModel: 'Intel Core i7-13700K',
        gpuModel: 'NVIDIA RTX 4070 12GB',
        totalRamGb: 32,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 1000, freeGb: null }]),
        status: 'available',
      },
      {
        name: 'PC-LAB-09',
        description: 'Desktop Física Computacional',
        cpuModel: 'AMD Ryzen 7 5700X',
        gpuModel: 'AMD Radeon RX 6700 XT 12GB',
        totalRamGb: 32,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 512, freeGb: null }]),
        status: 'available',
      },
      {
        name: 'PC-LAB-10',
        description: 'Desktop Análise de Dados — Offline',
        cpuModel: 'Intel Core i5-12400',
        gpuModel: 'NVIDIA GTX 1650 4GB',
        totalRamGb: 16,
        disksJson: JSON.stringify([{ device: '/dev/sda1', mountpoint: '/', fstype: null, totalGb: 512, freeGb: null }]),
        status: 'offline',
      },
    ])

    console.log('\n📟 Tokens das máquinas (salve para testes do Agent):')
    console.log('='.repeat(80))
    for (const machine of machines) {
      console.log(`${machine.name}: ${machine.token}`)
    }
    console.log('='.repeat(80) + '\n')
  }
}
