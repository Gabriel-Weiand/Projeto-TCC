import type { HttpContext } from '@adonisjs/core/http'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import { createMachineValidator, updateMachineValidator } from '#validators/machine'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { machineCache } from '#services/machine_cache'
import { DateTime } from 'luxon'

export default class MachinesController {
  /**
   * Normaliza telemetria bruta (escala 0-1000 / 0-1500) para valores legíveis.
   * Usage: 0-1000 → 0-100 (porcentagem)
   * Temp:  0-1500 → 0-150 (°C)
   * Rede:  Mbps (sem conversão)
   */
  private normalizeTelemetry(raw: Record<string, unknown> | null) {
    if (!raw) return null
    return {
      cpuUsage: Number(raw.cpuUsage ?? 0) / 10,
      cpuTemp: Number(raw.cpuTemp ?? 0) / 10,
      gpuUsage: Number(raw.gpuUsage ?? 0) / 10,
      gpuTemp: Number(raw.gpuTemp ?? 0) / 10,
      ramUsage: Number(raw.ramUsage ?? 0) / 10,
      diskUsage: raw.diskUsage != null ? Number(raw.diskUsage) / 10 : null,
      downloadUsage: raw.downloadUsage ?? null,
      uploadUsage: raw.uploadUsage ?? null,
      moboTemperature: raw.moboTemperature != null ? Number(raw.moboTemperature) / 10 : null,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Lista todas as máquinas.
   *
   * GET /api/v1/machines
   */
  async index({ auth, response }: HttpContext) {
    const user = auth.user!
    const machines = await Machine.query().orderBy('name', 'asc')

    // Adiciona telemetria real-time de cada máquina
    const machinesWithTelemetry = machines.map((machine) => {
      const raw = telemetryBuffer.getLatest(machine.id)
      const serialized = machine.serialize()

      // Oculta macAddress para usuários normais
      if (user.role !== 'admin') {
        delete serialized.macAddress
      }

      return {
        ...serialized,
        latestTelemetry: this.normalizeTelemetry(raw as Record<string, unknown>),
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
   * - Admin: vê o token para configurar o agente
   * - User normal: vê specs e telemetria (sem token)
   *
   * GET /api/v1/machines/:id
   */
  async show({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const machine = await Machine.findOrFail(params.id)

    // Adiciona telemetria real-time (normalizada)
    const raw = telemetryBuffer.getLatest(machine.id)

    const serialized: Record<string, unknown> = {
      ...machine.serialize(),
      latestTelemetry: this.normalizeTelemetry(raw as Record<string, unknown>),
    }

    // Apenas admin pode ver o token e macAddress
    if (user.role === 'admin') {
      serialized.token = machine.token
    } else {
      delete serialized.macAddress
    }

    return response.ok(serialized)
  }

  /**
   * Atualiza uma máquina.
   * Se entrar em manutenção, cancela todas as alocações futuras.
   *
   * PUT /api/v1/machines/:id
   */
  async update({ params, request, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    const data = await request.validateUsing(updateMachineValidator)

    const wasNotInMaintenance = machine.status !== 'maintenance'
    const isEnteringMaintenance = data.status === 'maintenance'

    machine.merge(data)
    await machine.save()

    // Se entrou em manutenção, cancela alocações futuras
    let cancelledCount = 0
    if (wasNotInMaintenance && isEnteringMaintenance) {
      const now = DateTime.now().toMillis()

      // Busca alocações futuras e cancela em JavaScript (SQLite não compara datas bem)
      const futureAllocations = await Allocation.query()
        .where('machineId', machine.id)
        .whereIn('status', ['approved', 'pending'])

      const toCancel = futureAllocations.filter((a) => a.startTime.toMillis() > now)

      for (const allocation of toCancel) {
        allocation.status = 'cancelled'
        await allocation.save()
        cancelledCount++
      }
    }

    // Invalida cache se existir
    machineCache.invalidateById(machine.id)

    return response.ok({
      ...machine.serialize(),
      cancelledAllocations: cancelledCount > 0 ? cancelledCount : undefined,
    })
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
   * Busca as telemetrias através das alocações da máquina.
   *
   * GET /api/v1/machines/:id/telemetry
   */
  async telemetry({ params, request, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    const { page = 1, limit = 100 } = request.qs()

    // Busca alocações da máquina e carrega suas telemetrias
    const allocations = await Allocation.query().where('machineId', machine.id).select('id')

    const allocationIds = allocations.map((a) => a.id)

    if (allocationIds.length === 0) {
      return response.ok({
        realtime: this.normalizeTelemetry(
          telemetryBuffer.getLatest(machine.id) as Record<string, unknown>
        ),
        history: { data: [], meta: { total: 0, perPage: limit, currentPage: page } },
      })
    }

    // Importa Telemetry aqui para a query
    const Telemetry = (await import('#models/telemetry')).default

    const telemetries = await Telemetry.query()
      .whereIn('allocationId', allocationIds)
      .orderBy('id', 'desc')
      .paginate(page, limit)

    // Adiciona dado real-time no topo (normalizado)
    const latestRealtime = telemetryBuffer.getLatest(machine.id)

    return response.ok({
      realtime: this.normalizeTelemetry(latestRealtime as Record<string, unknown>),
      history: telemetries,
    })
  }

  /**
   * Regenera o token de autenticação de uma máquina.
   * Usado para rotação de segurança ou se o token foi comprometido.
   *
   * POST /api/v1/machines/:id/regenerate-token
   */
  async regenerateToken({ params, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)

    // Invalida cache do token antigo
    machineCache.invalidate(machine.token)

    // Regenera o token
    const newToken = machine.regenerateToken()
    await machine.save()

    return response.ok({
      message: 'Token regenerado com sucesso. Configure o agente com o novo token.',
      machineId: machine.id,
      machineName: machine.name,
      token: newToken,
      tokenRotatedAt: machine.tokenRotatedAt,
    })
  }
}
