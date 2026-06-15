import type Machine from '#models/machine'
import { machineCache } from '#services/machine/cache'
import { applySyncSpecsIfEmpty, type SyncSpecsPayload } from '#services/machine/specs_merge'

export const SyncSpecsService = {
  async apply(machine: Machine, data: SyncSpecsPayload) {
    applySyncSpecsIfEmpty(machine, data)
    await machine.save()
    machineCache.invalidate(machine.token)

    return {
      synced: true,
      machine: {
        id: machine.id,
        name: machine.name,
        cpuModel: machine.cpuModel,
        gpuModel: machine.gpuModel,
        totalVramGb: machine.totalVramGb,
        totalRamGb: machine.totalRamGb,
        totalDiskGb: machine.totalDiskGb,
      },
    }
  },
}
