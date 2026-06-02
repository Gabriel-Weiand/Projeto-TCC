import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Machine from '#models/machine'
import MachineGroup from '#models/machine_group'

export default class extends BaseSeeder {
  async run() {
    const groupGpu = await MachineGroup.create({
      title: 'Máquinas com placa dedicada',
      description:
        'Workstations com GPU NVIDIA ou AMD para deep learning, visão computacional e inferência.',
    })

    const groupRender = await MachineGroup.create({
      title: 'Renderização e VFX',
      description: 'Alto número de núcleos, muita RAM e discos rápidos para Blender, Cinema 4D e pipelines 3D.',
    })

    const groupSim = await MachineGroup.create({
      title: 'Simulações e HPC leve',
      description:
        'Nós para CFD, FEM e workloads científicos — CPUs potentes, presets eco ou custom.',
    })

    const groupGeral = await MachineGroup.create({
      title: 'Uso geral e programação',
      description: 'Desktops para desenvolvimento web, análise de dados e aulas introdutórias.',
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

    const amdGpuLong =
      'Advanced Micro Devices, Inc. [AMD/ATI] Navi 33 [Radeon RX 7700S/7600/7600S/7600M XT/7600M XT/PRO W7600]'

    const machines = [
      // —— PC real do laboratório (mantido para o agente) ——
      {
        name: 'PC-LAB-01',
        description: 'Workstation Deep Learning',
        machineGroupId: groupGpu.id,
        cpuModel: 'AMD Ryzen 5 3600 6-Core Processor',
        gpuModel: amdGpuLong,
        totalRamGb: 15.5,
        ipAddress: '192.168.8.3',
        status: 'occupied' as const,
        telemetryPreset: 'custom' as const,
        customAgentConfig: baseConfig,
        disks: [
          {
            device: '/dev/nvme0n1p3',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 190.2,
            freeGb: 102.6,
          },
        ],
      },
      {
        name: 'PC-LAB-02',
        description: 'Treino distribuído — RTX 4090',
        machineGroupId: groupGpu.id,
        cpuModel: 'Intel Core i9-13900K',
        gpuModel: 'NVIDIA GeForce RTX 4090 24GB',
        totalRamGb: 128,
        ipAddress: '192.168.8.12',
        status: 'available' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        disks: [
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/boot/efi',
            fstype: 'vfat',
            totalGb: 0.5,
            freeGb: 0.3,
          },
          {
            device: '/dev/nvme0n1p2',
            mountpoint: '/boot',
            fstype: 'ext4',
            totalGb: 2,
            freeGb: 1.2,
          },
          {
            device: '/dev/nvme0n1p3',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 3800,
            freeGb: 2100,
          },
          {
            device: '/dev/sdb1',
            mountpoint: '/datasets',
            fstype: 'xfs',
            totalGb: 8000,
            freeGb: 6200,
          },
        ],
      },
      {
        name: 'PC-LAB-03',
        description: 'Render farm node — Threadripper',
        machineGroupId: groupRender.id,
        cpuModel: 'AMD Ryzen Threadripper 3990X 64-Core',
        gpuModel: 'NVIDIA GeForce GTX 1660 SUPER 6GB',
        totalRamGb: 256,
        ipAddress: '192.168.8.20',
        status: 'available' as const,
        telemetryPreset: 'custom' as const,
        customAgentConfig: { ...baseConfig, intervalSeconds: 10, batchSize: 8 },
        disks: [
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'btrfs',
            totalGb: 2000,
            freeGb: 450,
          },
          {
            device: '/dev/sda1',
            mountpoint: '/scratch',
            fstype: 'xfs',
            totalGb: 12000,
            freeGb: 8000,
          },
          {
            device: '/dev/sdb1',
            mountpoint: '/cache',
            fstype: 'ext4',
            totalGb: 4000,
            freeGb: 3900,
          },
        ],
      },
      {
        name: 'PC-LAB-04',
        description: 'Estação VFX — RTX 3080 (manutenção de driver)',
        machineGroupId: groupRender.id,
        cpuModel: 'Intel Core i9-12900K',
        gpuModel: 'NVIDIA GeForce RTX 3080 10GB',
        totalRamGb: 64,
        ipAddress: '192.168.8.21',
        status: 'maintenance' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 1800, freeGb: 200 },
          { device: '/dev/sda1', mountpoint: '/render', fstype: 'ext4', totalGb: 6000, freeGb: 1200 },
        ],
      },
      {
        name: 'PC-LAB-05',
        description: 'CFD workstation — Xeon + Quadro',
        machineGroupId: groupSim.id,
        cpuModel: 'Intel Xeon Silver 4314 16-Core',
        gpuModel: 'NVIDIA RTX A4000 16GB',
        totalRamGb: 128,
        ipAddress: '192.168.8.30',
        status: 'available' as const,
        telemetryPreset: 'custom' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', fstype: 'ext4', totalGb: 500, freeGb: 180 },
          { device: '/dev/sda2', mountpoint: '/sim', fstype: 'ext4', totalGb: 3500, freeGb: 900 },
          { device: '/dev/sdb1', mountpoint: '/results', fstype: 'xfs', totalGb: 8000, freeGb: 5000 },
        ],
      },
      {
        name: 'PC-LAB-06',
        description: 'Cluster edge — EPYC sem GPU dedicada',
        machineGroupId: groupSim.id,
        cpuModel: 'AMD EPYC 7443 24-Core',
        gpuModel: null,
        totalRamGb: 512,
        ipAddress: '192.168.8.31',
        status: 'offline' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 960, freeGb: 400 },
          { device: '/dev/md0', mountpoint: '/data', fstype: 'xfs', totalGb: 24000, freeGb: 18000 },
        ],
      },
      {
        name: 'PC-LAB-07',
        description: 'Desktop programação web',
        machineGroupId: groupGeral.id,
        cpuModel: 'Intel Core i5-10400F',
        gpuModel: 'NVIDIA GeForce GTX 1050 Ti 4GB',
        totalRamGb: 16,
        ipAddress: '192.168.8.40',
        status: 'occupied' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', fstype: 'ext4', totalGb: 240, freeGb: 38 },
          { device: '/dev/sda2', mountpoint: '/home', fstype: 'ext4', totalGb: 16, freeGb: 4 },
        ],
      },
      {
        name: 'PC-LAB-08',
        description: 'Análise de dados — iGPU apenas',
        machineGroupId: groupGeral.id,
        cpuModel: 'Intel Core i5-12400',
        gpuModel: 'Intel UHD Graphics 730',
        totalRamGb: 32,
        ipAddress: '192.168.8.41',
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 512, freeGb: 310 },
        ],
      },
      {
        name: 'PC-LAB-09',
        description: 'Visão computacional — dual storage AMD',
        machineGroupId: groupGpu.id,
        cpuModel: 'AMD Ryzen 7 7800X3D 8-Core',
        gpuModel: amdGpuLong,
        totalRamGb: 32,
        ipAddress: '192.168.8.13',
        status: 'available' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 1000, freeGb: 640 },
          { device: '/dev/sda1', mountpoint: '/models', fstype: 'ext4', totalGb: 2000, freeGb: 1500 },
        ],
      },
      {
        name: 'PC-LAB-10',
        description: 'Laboratório introdutório — dual boot',
        machineGroupId: groupGeral.id,
        cpuModel: 'AMD Ryzen 5 5600G with Radeon Graphics',
        gpuModel: 'AMD Radeon Graphics (integrated)',
        totalRamGb: 16,
        ipAddress: '192.168.8.42',
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 256, freeGb: 90 },
          {
            device: '/dev/nvme0n1p2',
            mountpoint: '/mnt/windows',
            fstype: 'ntfs',
            totalGb: 256,
            freeGb: 40,
          },
          { device: '/dev/sda1', mountpoint: '/shared', fstype: 'ext4', totalGb: 1000, freeGb: 800 },
        ],
      },
    ]

    for (const m of machines) {
      await Machine.create(m)
    }
  }
}
