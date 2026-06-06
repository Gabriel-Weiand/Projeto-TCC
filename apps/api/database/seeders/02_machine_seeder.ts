import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import Machine from '#models/machine'
import MachineGroup from '#models/machine_group'
import { enrichDiskPartitions, type DiskPartitionRecord } from '#services/disk_partitions'

type SeedDisk = {
  device: string
  mountpoint: string
  fstype: string
  totalGb: number
  freeGb: number
  role?: 'system' | 'user'
  mainDisk?: boolean
}

function seedDisks(raw: SeedDisk[]): DiskPartitionRecord[] {
  return enrichDiskPartitions(raw)
}

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

    /** Fingerprints de host (como enviados pelo agente em sync-specs) — demo SSH no front. */
    const hostFingerprints: Record<string, string> = {
      'PC-LAB-01': 'SHA256:7Kp2mN9qR4sT6uV8wX0yZ2aB4cD6eF8gH0jL2nP4rS6tU8vW0yZ2aB4cD6',
      'PC-LAB-02': 'SHA256:4090_rtx_host_ed25519_fp_demo_lab02_ufpel',
      'PC-LAB-03': 'SHA256:a6000_cuda_host_ed25519_fp_demo_lab03',
      'PC-LAB-04': 'SHA256:3080_maintenance_host_fp_demo_lab04',
      'PC-LAB-05': 'SHA256:a5000_simulation_host_fp_demo_lab05',
      'PC-LAB-06': 'SHA256:epyc_dataset_server_host_fp_demo_lab06',
      'PC-LAB-07': 'SHA256:3060_prototype_host_fp_demo_lab07',
      'PC-LAB-08': 'SHA256:ingest_4k_host_fp_demo_lab08',
      'PC-LAB-09': 'SHA256:rx7600_detection_host_fp_demo_lab09',
      'PC-LAB-10': 'SHA256:ryzen5600g_editing_host_fp_demo_lab10',
      'PC-LAB-11': 'SHA256:multi_disk_free_choice_host_fp_demo_lab11',
      'PC-LAB-12': 'SHA256:multi_disk_main_only_host_fp_demo_lab12',
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
        sshPort: 2222,
        hostFingerprint: hostFingerprints['PC-LAB-01'],
        status: 'occupied' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p3',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 190.2,
            freeGb: 102.6,
            role: 'system',
          },
          {
            device: '/dev/sda1',
            mountpoint: '/datasets/video',
            fstype: 'ext4',
            totalGb: 2000,
            freeGb: 1400,
            role: 'user',
            mainDisk: true,
          },
        ]),
      },
      {
        name: 'PC-LAB-02',
        description: 'RTX 4090 — fine-tuning (multi-disco, só disco principal)',
        machineGroupId: groupVideoCuda.id,
        cpuModel: 'Intel Core i9-13900K',
        gpuModel: 'NVIDIA GeForce RTX 4090 24GB',
        totalVramGb: 240,
        totalRamGb: 1280,
        ipAddress: '192.168.8.12',
        sshPort: null,
        hostFingerprint: hostFingerprints['PC-LAB-02'],
        status: 'occupied' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: true,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p3',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 3800,
            freeGb: 2100,
            role: 'system',
          },
          {
            device: '/dev/sdb1',
            mountpoint: '/datasets/raw',
            fstype: 'xfs',
            totalGb: 8000,
            freeGb: 6200,
            role: 'user',
            mainDisk: true,
          },
          {
            device: '/dev/sdc1',
            mountpoint: '/scratch/fast',
            fstype: 'xfs',
            totalGb: 4000,
            freeGb: 3200,
            role: 'user',
          },
        ]),
      },
      {
        name: 'PC-LAB-03',
        description: 'RTX A6000 48GB — multi-disco, escolha livre de volume',
        machineGroupId: groupVideoCuda.id,
        cpuModel: 'AMD Ryzen Threadripper 3970X 32-Core',
        gpuModel: 'NVIDIA RTX A6000 48GB',
        totalVramGb: 480,
        totalRamGb: 2560,
        ipAddress: '192.168.8.20',
        sshPort: 8022,
        hostFingerprint: hostFingerprints['PC-LAB-03'],
        status: 'available' as const,
        telemetryPreset: 'custom' as const,
        customAgentConfig: { ...baseConfig, intervalSeconds: 8, batchSize: 6 },
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'btrfs',
            totalGb: 2000,
            freeGb: 450,
            role: 'system',
          },
          {
            device: '/dev/nvme0n1p2',
            mountpoint: '/home',
            fstype: 'btrfs',
            totalGb: 500,
            freeGb: 320,
            role: 'user',
          },
          {
            device: '/dev/sda1',
            mountpoint: '/scratch',
            fstype: 'xfs',
            totalGb: 12000,
            freeGb: 8000,
            role: 'user',
            mainDisk: true,
          },
        ]),
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
        sshPort: null,
        hostFingerprint: hostFingerprints['PC-LAB-04'],
        status: 'maintenance' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 1800,
            freeGb: 200,
            role: 'system',
          },
          {
            device: '/dev/sda1',
            mountpoint: '/render',
            fstype: 'ext4',
            totalGb: 6000,
            freeGb: 1200,
            role: 'user',
            mainDisk: true,
          },
        ]),
      },
      {
        name: 'PC-LAB-05',
        description: 'RTX A5000 — optical flow e simulação CUDA',
        machineGroupId: groupSimCuda.id,
        cpuModel: 'Intel Xeon Silver 4314 16-Core',
        gpuModel: 'NVIDIA RTX A5000 24GB',
        totalVramGb: 240,
        totalRamGb: 1280,
        ipAddress: '192.168.8.30',
        sshPort: 22022,
        hostFingerprint: hostFingerprints['PC-LAB-05'],
        status: 'available' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/sda1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 500,
            freeGb: 180,
            role: 'system',
          },
          {
            device: '/dev/sda2',
            mountpoint: '/sim',
            fstype: 'ext4',
            totalGb: 3500,
            freeGb: 900,
            role: 'user',
            mainDisk: true,
          },
          {
            device: '/dev/sdb1',
            mountpoint: '/bulk',
            fstype: 'ext4',
            totalGb: 8000,
            freeGb: 6100,
            role: 'user',
          },
        ]),
      },
      {
        name: 'PC-LAB-06',
        description: 'Servidor de datasets — transcode FFmpeg (sem GPU dedicada)',
        machineGroupId: groupData.id,
        cpuModel: 'AMD EPYC 7443 24-Core',
        gpuModel: null,
        totalRamGb: 5120,
        ipAddress: '192.168.8.31',
        sshPort: null,
        hostFingerprint: hostFingerprints['PC-LAB-06'],
        status: 'offline' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: { ...baseConfig, telemetrySet: { ...baseConfig.telemetrySet, gpu: false } },
        onlyMainDisk: true,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 960,
            freeGb: 400,
            role: 'system',
          },
          {
            device: '/dev/md0',
            mountpoint: '/data/video',
            fstype: 'xfs',
            totalGb: 24000,
            freeGb: 18000,
            role: 'user',
            mainDisk: true,
          },
          {
            device: '/dev/sdb1',
            mountpoint: '/data/staging',
            fstype: 'xfs',
            totalGb: 8000,
            freeGb: 7200,
            role: 'user',
          },
        ]),
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
        sshPort: 2222,
        hostFingerprint: hostFingerprints['PC-LAB-07'],
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 1000,
            freeGb: 520,
            role: 'system',
          },
        ]),
      },
      {
        name: 'PC-LAB-08',
        description: 'Ingestão 4K — multi-disco, só disco principal (/archive)',
        machineGroupId: groupData.id,
        cpuModel: 'Intel Core i5-12400',
        gpuModel: 'Intel UHD Graphics 730',
        totalRamGb: 320,
        ipAddress: '192.168.8.41',
        sshPort: null,
        hostFingerprint: hostFingerprints['PC-LAB-08'],
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: true,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 512,
            freeGb: 310,
            role: 'system',
          },
          {
            device: '/dev/sda1',
            mountpoint: '/archive',
            fstype: 'ext4',
            totalGb: 8000,
            freeGb: 6500,
            role: 'user',
            mainDisk: true,
          },
          {
            device: '/dev/sdb1',
            mountpoint: '/ingest',
            fstype: 'ext4',
            totalGb: 4000,
            freeGb: 3600,
            role: 'user',
          },
        ]),
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
        sshPort: 8022,
        hostFingerprint: hostFingerprints['PC-LAB-09'],
        status: 'occupied' as const,
        telemetryPreset: 'fast' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 1000,
            freeGb: 640,
            role: 'system',
          },
          {
            device: '/dev/nvme0n1p2',
            mountpoint: '/home',
            fstype: 'ext4',
            totalGb: 400,
            freeGb: 280,
            role: 'user',
          },
          {
            device: '/dev/sda1',
            mountpoint: '/models',
            fstype: 'ext4',
            totalGb: 2000,
            freeGb: 1500,
            role: 'user',
            mainDisk: true,
          },
        ]),
      },
      {
        name: 'PC-LAB-10',
        description: 'Estação leve — edição e testes de pipeline (aulas)',
        machineGroupId: groupPost.id,
        cpuModel: 'AMD Ryzen 5 5600G with Radeon Graphics',
        gpuModel: 'AMD Radeon Graphics (integrated)',
        totalRamGb: 160,
        ipAddress: '192.168.8.42',
        sshPort: null,
        hostFingerprint: hostFingerprints['PC-LAB-10'],
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 512,
            freeGb: 200,
            role: 'system',
          },
        ]),
      },
      {
        name: 'PC-LAB-11',
        description: 'Demo multi-disco — escolha livre (/home ou /data/lab, principal em /data/lab)',
        machineGroupId: groupData.id,
        cpuModel: 'Intel Core i7-13700K',
        gpuModel: 'NVIDIA GeForce RTX 4070 12GB',
        totalVramGb: 120,
        totalRamGb: 640,
        ipAddress: '192.168.8.50',
        sshPort: null,
        hostFingerprint: hostFingerprints['PC-LAB-11'],
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: false,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 900,
            freeGb: 480,
            role: 'system',
          },
          {
            device: '/dev/nvme0n1p2',
            mountpoint: '/home',
            fstype: 'ext4',
            totalGb: 600,
            freeGb: 410,
            role: 'user',
          },
          {
            device: '/dev/sda1',
            mountpoint: '/data/lab',
            fstype: 'xfs',
            totalGb: 6000,
            freeGb: 5200,
            role: 'user',
            mainDisk: true,
          },
        ]),
      },
      {
        name: 'PC-LAB-12',
        description: 'Demo multi-disco — somente principal (/data/lab, onlyMainDisk)',
        machineGroupId: groupData.id,
        cpuModel: 'Intel Core i7-13700K',
        gpuModel: 'NVIDIA GeForce RTX 4070 12GB',
        totalVramGb: 120,
        totalRamGb: 640,
        ipAddress: '192.168.8.51',
        sshPort: null,
        hostFingerprint: hostFingerprints['PC-LAB-12'],
        status: 'available' as const,
        telemetryPreset: 'eco' as const,
        customAgentConfig: baseConfig,
        onlyMainDisk: true,
        disks: seedDisks([
          {
            device: '/dev/nvme0n1p1',
            mountpoint: '/',
            fstype: 'ext4',
            totalGb: 900,
            freeGb: 480,
            role: 'system',
          },
          {
            device: '/dev/nvme0n1p2',
            mountpoint: '/home',
            fstype: 'ext4',
            totalGb: 600,
            freeGb: 410,
            role: 'user',
          },
          {
            device: '/dev/sda1',
            mountpoint: '/data/lab',
            fstype: 'xfs',
            totalGb: 6000,
            freeGb: 5200,
            role: 'user',
            mainDisk: true,
          },
        ]),
      },
    ]

    /** Sem heartbeat recente → status efetivo offline (exceto maintenance/disabled). */
    const machinesWithoutHeartbeat = new Set(['PC-LAB-06', 'PC-LAB-08'])

    const heartbeatOffsetsHours: Record<string, number> = {
      'PC-LAB-01': 1,
      'PC-LAB-02': 3,
      'PC-LAB-03': 2,
      'PC-LAB-04': 6,
      'PC-LAB-05': 4,
      'PC-LAB-07': 8,
      'PC-LAB-09': 5,
      'PC-LAB-10': 12,
      'PC-LAB-11': 2,
      'PC-LAB-12': 2,
    }

    console.log('\n--- Tokens das máquinas (MACHINE_TOKEN no agente) ---')
    for (const m of machines) {
      const lastSeenAt = machinesWithoutHeartbeat.has(m.name)
        ? null
        : DateTime.utc().minus({ hours: heartbeatOffsetsHours[m.name] ?? 2 })
      const created = await Machine.create({ ...m, lastSeenAt })
      console.log(`  ${created.name}: ${created.token}`)
    }
    console.log('---\n')
  }
}
