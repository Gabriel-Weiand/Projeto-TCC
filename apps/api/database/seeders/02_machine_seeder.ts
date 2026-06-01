import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Machine from '#models/machine'
import MachineGroup from '#models/machine_group'

export default class extends BaseSeeder {
  async run() {
    const groupIA = await MachineGroup.create({
      title: 'Laboratório de IA & Deep Learning',
      description: 'Workstations equipadas com GPUs parrudas (NVIDIA RTX 3090/4090).',
    })

    const groupRender = await MachineGroup.create({
      title: 'Laboratório de Renderização 3D',
      description: 'Máquinas focadas em alta contagem de núcleos e Muita RAM.',
    })

    const groupGeral = await MachineGroup.create({
      title: 'Uso Geral & Programação',
      description: 'Desktops padrão para análise de dados e navegação.',
    })

    const baseConfig = {
      intervalSeconds: 5,
      batchSize: 5,
      processThresholds: {
        cpuPercent: 2.0,
        gpuPercent: 5.0,
        ramMb: 200,
        vramMb: 50,
        diskReadKbps: 500,
        diskWriteKbps: 500,
        topX: 10,
      },
      telemetrySet: {
        cpu: true,
        gpu: true,
        ramAndSwap: true,
        diskSpace: true,
        diskIO: true,
        networkIO: true,
        temperatures: true,
        activeUsers: true,
      },
    }

    const machines = [
      {
        name: 'PC-LAB-01',
        description: 'Workstation Deep Learning — RTX 3090',
        machineGroupId: groupIA.id,
        cpuModel: 'AMD Ryzen 9 5900X',
        gpuModel: 'NVIDIA RTX 3090 24GB',
        totalRamGb: 64,
        status: 'occupied' as const,
        telemetryPreset: 'fast' as const,
        hostFingerprint: 'SHA256:T1xK/9PjLmNwQsZ+yR/4gV8h... fakeFP_PC01',
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', fstype: 'ext4', totalGb: 2000, freeGb: 800 },
        ],
      },
      {
        name: 'PC-LAB-02',
        description: 'Workstation NLP — RTX 4090',
        machineGroupId: groupIA.id,
        cpuModel: 'Intel Core i9-13900K',
        gpuModel: 'NVIDIA RTX 4090 24GB',
        totalRamGb: 128,
        status: 'available' as const,
        telemetryPreset: 'custom' as const,
        customAgentConfig: baseConfig,
        disks: [
          {
            device: '/dev/nvme0n1p2',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 4000,
            freeGb: 3500,
          },
        ],
      },
      {
        name: 'PC-LAB-03',
        description: 'Servidor de Compilação — Threadripper',
        machineGroupId: groupRender.id,
        cpuModel: 'AMD Threadripper 3990X',
        gpuModel: 'NVIDIA GTX 1660',
        totalRamGb: 256,
        status: 'available' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sdb1', mountpoint: '/', fstype: 'btrfs', totalGb: 8000, freeGb: 2000 },
        ],
      },
      {
        name: 'PC-LAB-04',
        description: 'Workstation Renderização 3D — RTX 3080',
        machineGroupId: groupRender.id,
        cpuModel: 'Intel Core i9-12900K',
        gpuModel: 'NVIDIA RTX 3080 10GB',
        totalRamGb: 32,
        status: 'maintenance' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', fstype: 'ext4', totalGb: 1000, freeGb: 100 },
        ],
      },
      {
        name: 'PC-LAB-05',
        description: 'Desktop Análise de Dados 1',
        machineGroupId: groupGeral.id,
        cpuModel: 'Intel Core i5-12400',
        gpuModel: 'Intel UHD 730',
        totalRamGb: 16,
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', fstype: 'ext4', totalGb: 512, freeGb: 400 },
        ],
      },
      {
        name: 'PC-LAB-06',
        description: 'Desktop Análise de Dados 2',
        machineGroupId: groupGeral.id,
        cpuModel: 'AMD Ryzen 5 5600G',
        gpuModel: 'AMD Radeon Vega 7',
        totalRamGb: 16,
        status: 'offline' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', fstype: 'ext4', totalGb: 512, freeGb: 250 },
        ],
      },
      {
        name: 'PC-LAB-07',
        description: 'Desktop Programação Web',
        machineGroupId: groupGeral.id,
        cpuModel: 'Intel Core i5-10400F',
        gpuModel: 'NVIDIA GTX 1050 Ti',
        totalRamGb: 16,
        status: 'occupied' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1', mountpoint: '/', fstype: 'ext4', totalGb: 256, freeGb: 40 },
        ],
      },
    ]

    for (const m of machines) {
      await Machine.create(m)
    }
  }
}
