import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { telemetryReportValidator } from '#validators/telemetry'
import { heartbeatValidator, syncSpecsValidator } from '#validators/agent'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { machineCache } from '#services/machine_cache'
import HeartbeatService from '#services/heartbeat_service'
import Allocation from '#models/allocation'

export default class AgentController {
  async heartbeat({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const payload = await request.validateUsing(heartbeatValidator)

    // Instancia o serviço inteligente
    const heartbeatService = new HeartbeatService()
    const responseData = await heartbeatService.processHeartbeat(machine, payload)

    // Atualiza presença do agente; status efetivo é calculado na leitura (alocações + heartbeat).
    machine.lastSeenAt = DateTime.now()
    machine.currentSessions = payload.connectedUsers || []
    await machine.save()
    machineCache.invalidate(machine.token)

    return response.ok(responseData)
  }

  async syncSpecs({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(syncSpecsValidator)

    const { disks, ...machineData } = data as any
    machine.merge(machineData)

    if (disks !== undefined && Array.isArray(disks)) {
      machine.disks = disks
    }

    await machine.save()
    machineCache.invalidate(machine.token)

    return response.ok({
      synced: true,
      machine: {
        id: machine.id,
        name: machine.name,
        cpuModel: machine.cpuModel,
        gpuModel: machine.gpuModel,
        totalVramGb: machine.totalVramGb,
        totalRamGb: machine.totalRamGb,
      },
    })
  }

  async telemetry({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const { data } = await request.validateUsing(telemetryReportValidator)

    if (data.length === 0) return response.noContent()

    // 1. Procura se existe alguma alocação rodando neste exato segundo
    const nowMs = DateTime.now().toMillis()
    const activeAllocations = await Allocation.query()
      .where('machineId', machine.id)
      .whereIn('status', ['approved'])

    const activeAlloc = activeAllocations.find(
      (a) => a.startTime.toMillis() <= nowMs && a.endTime.toMillis() >= nowMs
    )

    // 2. Roteamento Inteligente da Telemetria
    const batchPayload = data.map((item) =>
      activeAlloc
        ? { allocationId: activeAlloc.id, ...item }
        : { allocationId: 0, ...item }
    )

    for (const item of batchPayload) {
      if (activeAlloc) {
        telemetryBuffer.add(machine.id, item)
      } else {
        telemetryBuffer.updateRealtime(machine.id, item)
      }
    }

    telemetryBuffer.recordBatch(machine.id, batchPayload)

    // 3. Atualiza presença do agente
    machine.lastSeenAt = DateTime.now()
    await machine.save()

    return response.noContent()
  }
}
