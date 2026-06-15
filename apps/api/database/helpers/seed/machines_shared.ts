import MachineGroup from '#models/machine_group'
import { enrichDiskPartitions, type DiskPartitionRecord } from '#services/machine/disk_partitions'
import type { MockLabMachine } from '../lab_mock_machines.js'

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

export function buildSeedDisks(
  machine: MockLabMachine,
  options?: { empty?: boolean }
): DiskPartitionRecord[] {
  const empty = options?.empty ?? false
  const disks: SeedDisk[] = machine.disksGb.map((totalGb, index) => {
    const isFirst = index === 0
    return {
      device: isFirst ? '/dev/nvme0n1p1' : `/dev/sd${String.fromCharCode(97 + index - 1)}1`,
      mountpoint: isFirst ? '/' : index === 1 ? '/data' : '/scratch',
      fstype: isFirst ? 'ext4' : 'xfs',
      totalGb,
      freeGb: empty ? totalGb : Math.round(totalGb * (0.35 + index * 0.08)),
      role: 'user',
      mainDisk: isFirst,
    }
  })

  if (disks.length === 1) {
    disks[0].mainDisk = true
  }

  return seedDisks(disks)
}

export async function createDefaultMachineGroups() {
  const groupGpu = await MachineGroup.create({
    title: 'CUDA — Simulações GPU',
    description:
      'Workstations NVIDIA para simulações CUDA, treino de modelos e benchmarks acelerados por GPU.',
  })

  const groupCpu = await MachineGroup.create({
    title: 'Servidores CPU',
    description: null,
  })

  return { groupGpu, groupCpu }
}
