import Machine from '#models/machine'
import {
  ANYDESK_DESCRIPTION,
  MOCK_LAB_MACHINES,
} from '../lab_mock_machines.js'
import { buildSeedDisks, createDefaultMachineGroups } from './machines_shared.js'

/** Máquinas excluídas do parque real (dev-only ou host pessoal). */
const LAB_PARK_EXCLUDED = new Set(['Notebook-server'])

/** Única máquina habilitada no perfil lab; demais ficam offline (disabled no front). */
const LAB_ACTIVE_MACHINE = 'GaciG1'

/** Parque real sem dados fictícios — agente preenche IP, fingerprint e telemetria. */
export async function seedLabMachines() {
  const { groupGpu, groupCpu } = await createDefaultMachineGroups()
  const park = MOCK_LAB_MACHINES.filter((machine) => !LAB_PARK_EXCLUDED.has(machine.name))

  console.log('\n--- Tokens das máquinas (MACHINE_TOKEN no agente) ---')
  console.log(`  Perfil lab: somente ${LAB_ACTIVE_MACHINE} habilitada; demais desativadas (offline).\n`)

  for (const machine of park) {
    const hasGpu = machine.hasGpu
    const isActive = machine.name === LAB_ACTIVE_MACHINE
    const envToken =
      isActive && process.env.LAB_SEED_GACIG1_TOKEN?.trim()
        ? process.env.LAB_SEED_GACIG1_TOKEN.trim()
        : undefined

    const created = await Machine.create({
      name: machine.name,
      description: machine.description ?? (machine.anyDeskOnly ? ANYDESK_DESCRIPTION : ''),
      token: envToken ?? machine.token,
      machineGroupId: hasGpu ? groupGpu.id : groupCpu.id,
      cpuModel: machine.cpuModel,
      gpuModel: machine.gpuModel,
      totalVramGb: machine.totalVramGb,
      totalRamGb: machine.totalRamGb,
      totalDiskGb: machine.disksGb[0]! * 10,
      ipAddress: null,
      sshPort: null,
      hostFingerprint: null,
      status: isActive ? 'available' : 'offline',
      telemetryPreset: hasGpu ? 'fast' : 'eco',
      customAgentConfig: null,
      onlyMainDisk: !hasGpu && machine.name.startsWith('Gaci'),
      disks: buildSeedDisks(machine, { empty: true }),
      lastSeenAt: null,
    })

    const marker = isActive ? ' ← ativa' : ''
    console.log(`  ${created.name}: ${created.token}${marker}`)
  }

  console.log('---\n')
}
