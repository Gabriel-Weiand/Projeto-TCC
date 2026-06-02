import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Machine from '#models/machine'
import MachineGroup from '#models/machine_group'

/**
 * Parque alinhado ao lab de pesquisa em vídeo (CUDA, codecs, deep learning de vídeo).
 * RAM/VRAM em wire GB×10 no banco (ex.: 155 = 15,5 GB RAM; 240 = 24 GB VRAM).
 */
export default class extends BaseSeeder {
  async run() {
    const groupVideoCuda = await MachineGroup.create({
      title: 'CUDA — Pesquisa em vídeo',
      description:
        'Workstations NVIDIA para treino/inferência de modelos de vídeo, NeRF, diffusion e pipelines PyTorch com CUDA.',
    })

    const groupSimCuda = await MachineGroup.create({
      title: 'CUDA — Simulação e benchmarks',
      description:
        'Nós para simulações aceleradas por GPU, optical flow, estabilização e experimentos de longa duração.',
    })

    const groupPost = await MachineGroup.create({
      title: 'Pós-produção e render',
      description:
        'Montagem, color grading, render de sequências e exportação (FFmpeg, Blender, DaVinci).',
    })

    const groupData = await MachineGroup.create({
      title: 'Datasets e pré-processamento',
      description:
        'Alto espaço em disco para ingestão de vídeos brutos, transcodificação e organização de corpora.',
    })

    const baseConfig = {
      intervalSeconds: 5,
      batchSize: 5,
      processThresholds: {
        cpuPercent: 2.0,
        gpuPercent: 5.0,
        ramMb: 500,
        vramMb: 200,
        diskReadKbps: 2000,
        diskWriteKbps: 2000,
        topX: 12,
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
        description: 'Estação principal — treino VideoMAE / codecs HEVC (agente real do lab)',
        machineGroupId: groupVideoCuda.id,
        cpuModel: 'AMD Ryzen 5 3600 6-Core Processor',
        gpuModel:
          'Advanced Micro Devices, Inc. [AMD/ATI] Navi 33 [Radeon RX 7700S/7600/7600M XT]',
        totalVramGb: 80,
        totalRamGb: 155,
        ipAddress: '192.168.8.3',
        status: 'occupied' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        disks: [
          {
            device: '/dev/nvme0n1p3',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 190.2,
            freeGb: 102.6,
          },
          {
            device: '/dev/sda1',
            mountpoint: '/datasets/video',
            fstype: 'ext4',
            totalGb: 2000,
            freeGb: 1400,
          },
        ],
      },
      {
        name: 'PC-LAB-02',
        description: 'RTX 4090 — fine-tuning e inferência batch (reservas longas)',
        machineGroupId: groupVideoCuda.id,
        cpuModel: 'Intel Core i9-13900K',
        gpuModel: 'NVIDIA GeForce RTX 4090 24GB',
        totalVramGb: 240,
        totalRamGb: 1280,
        ipAddress: '192.168.8.12',
        status: 'occupied' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p3', mountpoint: '/', fstype: 'ext4', totalGb: 3800, freeGb: 2100 },
          {
            device: '/dev/sdb1',
            mountpoint: '/datasets/raw',
            fstype: 'xfs',
            totalGb: 8000,
            freeGb: 6200,
          },
        ],
      },
      {
        name: 'PC-LAB-03',
        description: 'RTX A6000 48GB — modelos grandes de vídeo e multi-stream CUDA',
        machineGroupId: groupVideoCuda.id,
        cpuModel: 'AMD Ryzen Threadripper 3970X 32-Core',
        gpuModel: 'NVIDIA RTX A6000 48GB',
        totalVramGb: 480,
        totalRamGb: 2560,
        ipAddress: '192.168.8.20',
        status: 'available' as const,
        telemetryPreset: 'custom' as const,
        customAgentConfig: { ...baseConfig, intervalSeconds: 8, batchSize: 6 },
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'btrfs', totalGb: 2000, freeGb: 450 },
          { device: '/dev/sda1', mountpoint: '/scratch', fstype: 'xfs', totalGb: 12000, freeGb: 8000 },
        ],
      },
      {
        name: 'PC-LAB-04',
        description: 'RTX 3080 10GB — manutenção driver CUDA 12.x',
        machineGroupId: groupPost.id,
        cpuModel: 'Intel Core i9-12900K',
        gpuModel: 'NVIDIA GeForce RTX 3080 10GB',
        totalVramGb: 100,
        totalRamGb: 640,
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
        description: 'RTX A5000 — optical flow e simulação CUDA (semanas)',
        machineGroupId: groupSimCuda.id,
        cpuModel: 'Intel Xeon Silver 4314 16-Core',
        gpuModel: 'NVIDIA RTX A5000 24GB',
        totalVramGb: 240,
        totalRamGb: 1280,
        ipAddress: '192.168.8.30',
        status: 'available' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/sda1', mountpoint: '/', fstype: 'ext4', totalGb: 500, freeGb: 180 },
          { device: '/dev/sda2', mountpoint: '/sim', fstype: 'ext4', totalGb: 3500, freeGb: 900 },
        ],
      },
      {
        name: 'PC-LAB-06',
        description: 'Servidor de datasets — transcode FFmpeg (sem GPU dedicada)',
        machineGroupId: groupData.id,
        cpuModel: 'AMD EPYC 7443 24-Core',
        gpuModel: null,
        totalRamGb: 5120,
        ipAddress: '192.168.8.31',
        status: 'offline' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: { ...baseConfig, telemetrySet: { ...baseConfig.telemetrySet, gpu: false } },
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 960, freeGb: 400 },
          { device: '/dev/md0', mountpoint: '/data/video', fstype: 'xfs', totalGb: 24000, freeGb: 18000 },
        ],
      },
      {
        name: 'PC-LAB-07',
        description: 'RTX 3060 12GB — protótipos e ablações de arquitetura de vídeo',
        machineGroupId: groupSimCuda.id,
        cpuModel: 'Intel Core i7-12700K',
        gpuModel: 'NVIDIA GeForce RTX 3060 12GB',
        totalVramGb: 120,
        totalRamGb: 640,
        ipAddress: '192.168.8.40',
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 1000, freeGb: 520 },
        ],
      },
      {
        name: 'PC-LAB-08',
        description: 'Ingestão 4K — NVMe + HDD para corpora de pesquisa',
        machineGroupId: groupData.id,
        cpuModel: 'Intel Core i5-12400',
        gpuModel: 'Intel UHD Graphics 730',
        totalRamGb: 320,
        ipAddress: '192.168.8.41',
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 512, freeGb: 310 },
          { device: '/dev/sda1', mountpoint: '/archive', fstype: 'ext4', totalGb: 8000, freeGb: 6500 },
        ],
      },
      {
        name: 'PC-LAB-09',
        description: 'RX 7600 + CUDA via ROCm limitado — detecção de objetos em vídeo',
        machineGroupId: groupVideoCuda.id,
        cpuModel: 'AMD Ryzen 7 7800X3D 8-Core',
        gpuModel:
          'Advanced Micro Devices, Inc. [AMD/ATI] Navi 33 [Radeon RX 7700S/7600/7600M XT]',
        totalVramGb: 80,
        totalRamGb: 320,
        ipAddress: '192.168.8.13',
        status: 'occupied' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 1000, freeGb: 640 },
          { device: '/dev/sda1', mountpoint: '/models', fstype: 'ext4', totalGb: 2000, freeGb: 1500 },
        ],
      },
      {
        name: 'PC-LAB-10',
        description: 'Estação leve — edição e testes de pipeline (aulas)',
        machineGroupId: groupPost.id,
        cpuModel: 'AMD Ryzen 5 5600G with Radeon Graphics',
        gpuModel: 'AMD Radeon Graphics (integrated)',
        totalRamGb: 160,
        ipAddress: '192.168.8.42',
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        disks: [
          { device: '/dev/nvme0n1p1', mountpoint: '/', fstype: 'ext4', totalGb: 512, freeGb: 200 },
        ],
      },
    ]

    console.log('\n--- Tokens das máquinas (MACHINE_TOKEN no agente) ---')
    for (const m of machines) {
      const created = await Machine.create(m)
      console.log(`  ${created.name}: ${created.token}`)
    }
    console.log('---\n')
  }
}
