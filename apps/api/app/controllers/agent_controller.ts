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

    // Atualiza status básico da máquina
    machine.lastSeenAt = DateTime.now()

    const newStatus =
      payload.connectedUsers && payload.connectedUsers.length > 0 ? 'occupied' : 'available'

    if (machine.status !== 'maintenance' && machine.status !== newStatus) {
      machine.status = newStatus
      machine.currentSessions = payload.connectedUsers || []
      await machine.save()
      machineCache.invalidate(machine.token)
    } else {
      await machine.save()
    }

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
    for (const item of data) {
      if (activeAlloc) {
        // Se tem alocação: manda para o buffer de persistência no Banco (Flush)
        telemetryBuffer.add(machine.id, { allocationId: activeAlloc.id, ...item })
      } else {
        // Sem alocação: máquina está ligada atoa.
        // Atualiza só o cache Realtime pro Dashboard, mas descarta do banco para poupar espaço.
        telemetryBuffer.updateRealtime(machine.id, { allocationId: 0, ...item })
      }
    }

    // 3. Atualiza o status de atividade da máquina
    machine.lastSeenAt = DateTime.now()
    if (machine.status === 'offline') machine.status = 'available'
    await machine.save()

    return response.noContent()
  }
}
