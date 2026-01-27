import type { HttpContext } from '@adonisjs/core/http'
import Machine from '#models/machine'
import { createMachineValidator, updateMachineValidator } from '#validators/machine'
import { listTelemetryValidator } from '#validators/telemetry'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { machineCache } from '#services/machine_cache'
import Telemetry from '#models/telemetry'

export default class MachinesController {
  /**
   * Lista todas as máquinas.
   *
   * GET /api/v1/machines
   */
  async index({ response }: HttpContext) {
    const machines = await Machine.query().orderBy('name', 'asc')

    // Adiciona telemetria real-time de cada máquina
    const machinesWithTelemetry = machines.map((machine) => {
      const latestTelemetry = telemetryBuffer.getLatest(machine.id)
      return {
        ...machine.serialize(),
        latestTelemetry,
      }
    })

    return response.ok(machinesWithTelemetry)
  }

  /**
   * Cria uma nova máquina.
   * O token é gerado automaticamente pelo Model.
   *
   * POST /api/v1/machines
   */
  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(createMachineValidator)

    const machine = await Machine.create(data)

    // Retorna com o token (apenas na criação!)
    return response.created({
      ...machine.serialize(),
      token: machine.token, // Expõe o token apenas aqui
    })
  }

  /**
   * Exibe detalhes de uma máquina.
   *
   * GET /api/v1/machines/:id
   */
  async show({ params, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)

    // Adiciona telemetria real-time
    const latestTelemetry = telemetryBuffer.getLatest(machine.id)

    return response.ok({
      ...machine.serialize(),
      latestTelemetry,
    })
  }

  /**
   * Atualiza uma máquina.
   *
   * PUT /api/v1/machines/:id
   */
  async update({ params, request, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    const data = await request.validateUsing(updateMachineValidator)

    machine.merge(data)
    await machine.save()

    // Invalida cache se existir
    machineCache.invalidateById(machine.id)

    return response.ok(machine)
  }

  /**
   * Remove uma máquina.
   *
   * DELETE /api/v1/machines/:id
   */
  async destroy({ params, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)

    // Limpa cache e buffer
    machineCache.invalidateById(machine.id)
    telemetryBuffer.clearMachine(machine.id)

    await machine.delete()

    return response.noContent()
  }

  /**
   * Retorna histórico de telemetria de uma máquina.
   *
   * GET /api/v1/machines/:id/telemetry
   */
  async telemetry({ params, request, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    const {
      startDate,
      endDate,
      page = 1,
      limit = 100,
    } = await request.validateUsing(listTelemetryValidator)

    let query = Telemetry.query().where('machineId', machine.id).orderBy('createdAt', 'desc')

    if (startDate) {
      query = query.where('createdAt', '>=', startDate)
    }

    if (endDate) {
      query = query.where('createdAt', '<=', endDate)
    }

    const telemetries = await query.paginate(page, limit)

    // Adiciona dado real-time no topo
    const latestRealtime = telemetryBuffer.getLatest(machine.id)

    return response.ok({
      realtime: latestRealtime,
      history: telemetries,
    })
  }
}
