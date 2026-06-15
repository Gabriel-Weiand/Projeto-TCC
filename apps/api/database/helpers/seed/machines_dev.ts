import { DateTime } from 'luxon'
import Machine from '#models/machine'
import {
  ANYDESK_DESCRIPTION,
  MOCK_LAB_MACHINES,
} from '../lab_mock_machines.js'
import { buildSeedDisks, createDefaultMachineGroups } from './machines_shared.js'

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
    disk: true,
    networkIO: true,
    temperatures: true,
    activeUsers: true,
  },
}

/** Parque mock com status, heartbeats e IPs fictícios — perfil dev. */
export async function seedDevMachines() {
  const { groupGpu, groupCpu } = await createDefaultMachineGroups()

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

  const withoutHeartbeat = new Set(['GaciG8', 'Chomsky', 'Notebook-server'])

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
      description: machine.description ?? (machine.anyDeskOnly ? ANYDESK_DESCRIPTION : ''),
      token: machine.token,
      machineGroupId: hasGpu ? groupGpu.id : groupCpu.id,
      cpuModel: machine.cpuModel,
      gpuModel: machine.gpuModel,
      totalVramGb: machine.totalVramGb,
      totalRamGb: machine.totalRamGb,
      totalDiskGb: machine.disksGb[0]! * 10,
      ipAddress: machine.anyDeskOnly ? null : mockSshHost(machine.name),
      sshPort: machine.anyDeskOnly ? null : 50000,
      hostFingerprint: hostFingerprint(machine.name),
      status: statusByAlias[machine.name] ?? 'available',
      telemetryPreset: presetByAlias[machine.name] ?? (hasGpu ? 'fast' : 'eco'),
      customAgentConfig: agentConfig,
      onlyMainDisk: !hasGpu && machine.name.startsWith('Gaci'),
      disks: buildSeedDisks(machine),
      lastSeenAt,
    })

    console.log(`  ${created.name}: ${created.token}`)
  }

  console.log('---\n')
}
