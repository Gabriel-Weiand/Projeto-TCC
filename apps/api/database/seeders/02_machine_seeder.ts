import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import Machine from '#models/machine'
import MachineGroup from '#models/machine_group'
import { enrichDiskPartitions, type DiskPartitionRecord } from '#services/disk_partitions'
import {
  ANYDESK_DESCRIPTION,
  MOCK_LAB_MACHINES,
  type MockLabMachine,
} from '../helpers/lab_mock_machines.js'

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

function buildDisks(machine: MockLabMachine): DiskPartitionRecord[] {
  const disks: SeedDisk[] = machine.disksGb.map((totalGb, index) => {
    const isFirst = index === 0
    return {
      device: isFirst ? '/dev/nvme0n1p1' : `/dev/sd${String.fromCharCode(97 + index - 1)}1`,
      mountpoint: isFirst ? '/' : index === 1 ? '/data' : '/scratch',
      fstype: isFirst ? 'ext4' : 'xfs',
      totalGb,
      freeGb: Math.round(totalGb * (0.35 + index * 0.08)),
      role: isFirst ? 'system' : 'user',
      mainDisk: !isFirst && index === 1,
    }
  })

  if (disks.length === 1) {
    disks[0].mainDisk = true
  }

  return seedDisks(disks)
}

function mockSshHost(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return `${slug}.lab.local`
}

function hostFingerprint(alias: string): string {
  const slug = alias
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
  return `SHA256:ufpel_${slug}_host_ed25519_demo`
}

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

/** Parque mock do laboratório (nomes + specs). Conexão real fica fora do git. */
export default class extends BaseSeeder {
  async run() {
    const groupGpu = await MachineGroup.create({
      title: 'CUDA — Simulações GPU',
      description:
        'Workstations NVIDIA para simulações CUDA, treino de modelos e benchmarks acelerados por GPU.',
    })

    const groupCpu = await MachineGroup.create({
      title: 'Servidores CPU',
      description: null,
    })

    const statusByAlias: Record<string, 'available' | 'occupied' | 'maintenance' | 'offline'> = {
      Euler: 'occupied',
      Arendt: 'occupied',
      Chomsky: 'maintenance',
      GaciG8: 'offline',
    }

    const presetByAlias: Record<string, 'fast' | 'eco' | 'custom'> = {
      Euler: 'fast',
      Arendt: 'fast',
      Dijkstra: 'fast',
      GaciG6: 'eco',
      GaciG9: 'eco',
    }

    const withoutHeartbeat = new Set(['GaciG8', 'Chomsky'])

    console.log('\n--- Tokens das máquinas (MACHINE_TOKEN no agente) ---')

    for (const machine of MOCK_LAB_MACHINES) {
      const hasGpu = machine.hasGpu
      const agentConfig = hasGpu
        ? baseConfig
        : {
            ...baseConfig,
            intervalSeconds: 15,
            batchSize: 3,
            telemetrySet: { ...baseConfig.telemetrySet, gpu: false },
          }

      const lastSeenAt = withoutHeartbeat.has(machine.name)
        ? null
        : DateTime.utc().minus({ hours: statusByAlias[machine.name] === 'occupied' ? 1 : 4 })

      const created = await Machine.create({
        name: machine.name,
        description: machine.anyDeskOnly ? ANYDESK_DESCRIPTION : '',
        machineGroupId: hasGpu ? groupGpu.id : groupCpu.id,
        cpuModel: machine.cpuModel,
        gpuModel: machine.gpuModel,
        totalVramGb: machine.totalVramGb,
        totalRamGb: machine.totalRamGb,
        ipAddress: machine.anyDeskOnly ? null : mockSshHost(machine.name),
        sshPort: machine.anyDeskOnly ? null : 50000,
        hostFingerprint: hostFingerprint(machine.name),
        status: statusByAlias[machine.name] ?? 'available',
        telemetryPreset: presetByAlias[machine.name] ?? (hasGpu ? 'fast' : 'eco'),
        customAgentConfig: agentConfig,
        onlyMainDisk: !hasGpu && machine.name.startsWith('Gaci'),
        disks: buildDisks(machine),
        lastSeenAt,
      })

      console.log(`  ${created.name}: ${created.token}`)
    }

    console.log('---\n')
  }
}
