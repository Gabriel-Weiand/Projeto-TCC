import { DateTime } from 'luxon'
import Allocation from '#models/allocation'
import type Machine from '#models/machine'
import { updateMachinePresence } from '#services/agent/presence'
import { telemetryBuffer } from '#services/telemetry/buffer'
import { idleTelemetryBuffer } from '#services/telemetry/idle_buffer'
import { resolveMachineIntervalSeconds } from '#services/telemetry/presets'
import { shouldPersistAllocationSample } from '#services/telemetry/allocation_scalar_source'
import type { Infer } from '@vinejs/vine/types'
import type { telemetryReportValidator } from '#validators/telemetry'

type TelemetrySample = Infer<typeof telemetryReportValidator>['data'][number]

export const TelemetryIngestService = {
  /**
   * Normaliza o corpo bruto do POST antes da validação VineJS
   * (agente legado envia `disks` em vez de `disksInfo`).
   */
  normalizeRequestBody(body: { data?: Record<string, unknown>[] }) {
    if (!Array.isArray(body?.data)) return body

    return {
      ...body,
      data: body.data.map((item) => ({
        ...item,
        disksInfo: item.disksInfo ?? item.disks ?? null,
      })),
    }
  },

  async ingestBatch(machine: Machine, data: TelemetrySample[]) {
    if (data.length === 0) {
      return { empty: true as const }
    }

    const nowMs = DateTime.now().toMillis()
    const activeAllocations = await Allocation.query()
      .where('machineId', machine.id)
      .whereIn('status', ['approved'])

    const activeAlloc = activeAllocations.find(
      (a) => a.startTime.toMillis() <= nowMs && a.endTime.toMillis() >= nowMs
    )

    const batchPayload = data.map((item) =>
      activeAlloc ? { allocationId: activeAlloc.id, ...item } : { allocationId: 0, ...item }
    )

    for (const item of batchPayload) {
      const inAllocation = Boolean(activeAlloc)
      const intervalSeconds = resolveMachineIntervalSeconds(machine, inAllocation)

      if (activeAlloc) {
        telemetryBuffer.add(machine.id, item, {
          persist: shouldPersistAllocationSample(item),
        })
      } else {
        telemetryBuffer.updateRealtime(machine.id, item)
      }

      idleTelemetryBuffer.ingest(machine.id, item, intervalSeconds)
    }

    telemetryBuffer.recordBatch(machine.id, batchPayload)

    const latestDisksSample = [...batchPayload]
      .reverse()
      .find((item) => Array.isArray(item.disksInfo) && item.disksInfo.length > 0)

    await updateMachinePresence(machine, {
      disksInfo: latestDisksSample?.disksInfo ?? undefined,
    })

    return { empty: false as const }
  },
}
