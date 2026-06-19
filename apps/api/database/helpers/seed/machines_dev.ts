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

/** Máquinas que existem apenas no perfil dev (host pessoal de desenvolvimento). */
const DEV_ONLY_MACHINES = new Set(['Notebook-server'])

export type SeedMachinesOptions = {
  /** Inclui o Notebook-server (única diferença entre os perfis dev e lab). */
  includeNotebookServer: boolean
}

/**
 * Parque completo com status, heartbeats, IPs e fingerprints fictícios.
 * Usado nos perfis dev e lab — a única diferença é o Notebook-server (dev-only).
 */
export async function seedParkMachines(options: SeedMachinesOptions) {
  const { groupGpu, groupCpu } = await createDefaultMachineGroups()

  const park = MOCK_LAB_MACHINES.filter(
    (machine) => options.includeNotebookServer || !DEV_ONLY_MACHINES.has(machine.name)
  )

  // Presets "como antes": GPU → fast, CPU → eco, com overrides pontuais.
  const presetByAlias: Record<string, 'fast' | 'eco' | 'custom'> = {
    Euler: 'fast',
  }

  console.log('\n--- Tokens das máquinas (MACHINE_TOKEN no agente) ---')

  for (const machine of park) {
    const hasGpu = machine.hasGpu
    const agentConfig = hasGpu
      ? baseConfig
      : {
          ...baseConfig,
          intervalSeconds: 15,
          batchSize: 3,
          telemetrySet: { ...baseConfig.telemetrySet, gpu: false },
        }

    // Heartbeat recente → todo o parque entra online (GaciS1 também, porém livre).
    const lastSeenAt = DateTime.utc().minus({ minutes: 10 })

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
      status: 'available',
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
