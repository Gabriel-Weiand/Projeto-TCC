import type { HttpContext } from '@adonisjs/core/http'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import {
  createMachineValidator,
  requestProcessReportValidator,
  updateMachineValidator,
} from '#validators/machine'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { machineCache } from '#services/machine_cache'
import { DateTime } from 'luxon'
import { cancelAllocationsForMaintenance } from '#services/notification_service'
import { normalizeCustomAgentConfig } from '#services/telemetry_presets'
import {
  buildOccupiedMachineIds,
  normalizeOperationalMode,
  resolveEffectiveMachineStatus,
} from '#services/machine_effective_status'

export default class MachinesController {
  /** Agente envia GB×10; respostas HTTP ao front em GB (1 decimal). */
  private agentGbToApi(wire: number | null | undefined): number | null {
    if (wire == null) return null
    return Number(wire) / 10
  }

  /**
   * Normaliza telemetria bruta (escala 0-1000 / 0-1500) para valores legíveis.
   * Usage: 0-1000 → 0-100 (porcentagem)
   * Temp:  0-1500 → 0-150 (°C)
   * Rede:  Mbps (sem conversão)
   */
  private normalizeTelemetry(raw: unknown) {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>

    return {
      cpuUsage: Number(r.cpuUsage ?? 0) / 10,
      cpuTemp: Number(r.cpuTemp ?? 0) / 10,
      cpuFreqMhz: r.cpuFreqMhz ?? null, // Incluído

      gpuUsage: Number(r.gpuUsage ?? 0) / 10,
      gpuTemp: Number(r.gpuTemp ?? 0) / 10,
      gpuPowerWatts: r.gpuPowerWatts != null ? Number(r.gpuPowerWatts) : null,

      ramTotalGb: this.agentGbToApi(r.ramTotalGb as number | null),
      ramUsedGb: this.agentGbToApi(r.ramUsedGb as number | null),
      swapTotalGb: this.agentGbToApi(r.swapTotalGb as number | null),
      swapUsedGb: this.agentGbToApi(r.swapUsedGb as number | null),
      vramTotalGb: this.agentGbToApi(r.vramTotalGb as number | null),
      vramUsedGb: this.agentGbToApi(r.vramUsedGb as number | null),

      // Discos e Rede vêm diretamente como o agentd.py manda
      disksInfo: r.disks ?? null,
      diskReadMbps: r.diskReadMbps ?? null,
      diskWriteMbps: r.diskWriteMbps ?? null,
      downloadMbps: r.downloadMbps ?? null,
      uploadMbps: r.uploadMbps ?? null,

      moboTemperature: r.moboTemperature != null ? Number(r.moboTemperature) / 10 : null,
      activeUsers: r.activeUsers ?? null,

      // Timestamp original da coleta
      timestamp: r.timestamp ? String(r.timestamp) : new Date().toISOString(),
    }
  }

  /** Partições vindas do agente (JSON) — id estável para keys no front. */
  private mapMachineDisks(disks: unknown) {
    if (!Array.isArray(disks)) return []
    return disks.map((d: Record<string, unknown>, index: number) => ({
      id: typeof d.id === 'number' ? d.id : index,
      device: d.device,
      mountpoint: d.mountpoint,
      fstype: d.fstype ?? null,
      totalGb: d.totalGb ?? null,
      freeGb: d.freeGb ?? null,
    }))
  }

  private serializeMachineForApi(
    machine: Machine,
    rawTelemetry: unknown,
    occupiedMachineIds: Set<number>
  ) {
    const serialized = machine.serialize() as Record<string, unknown>
    const group = machine.group
    const operationalMode = normalizeOperationalMode(machine.status)
    const status = resolveEffectiveMachineStatus(machine, occupiedMachineIds)

    return {
      ...serialized,
      status,
      operationalMode,
      totalVramGb: this.agentGbToApi(machine.totalVramGb),
      totalRamGb: this.agentGbToApi(machine.totalRamGb),
      totalDiskGb: machine.totalDiskGb,
      machineGroupId: machine.machineGroupId,
      group: group
        ? {
            id: group.id,
            title: group.title,
            description: group.description,
          }
        : null,
      latestTelemetry: this.normalizeTelemetry(rawTelemetry),
      disks: this.mapMachineDisks(machine.disks),
    }
  }

  /**
   * Lista todas as máquinas.
   *
   * GET /api/v1/machines
   */
  async index({ response }: HttpContext) {
    const machines = await Machine.query().preload('group').orderBy('name', 'asc')
    const occupiedMachineIds = await buildOccupiedMachineIds()

    const machinesWithTelemetry = machines.map((machine) =>
      this.serializeMachineForApi(
        machine,
        telemetryBuffer.getLatest(machine.id),
        occupiedMachineIds
      )
    )

    return response.ok(machinesWithTelemetry)
  }

  /**
   * Cria uma nova máquina.
   * O token é gerado automaticamente pelo Model.
   *
   * POST /api/v1/machines
   */
  async store({ request, response }: HttpContext) {
    const data = (await request.validateUsing(createMachineValidator)) as any
    const { totalDiskGb, ...createData } = data

    const machine = await Machine.create(createData)

    const occupiedMachineIds = await buildOccupiedMachineIds()
    const presented = this.serializeMachineForApi(machine, null, occupiedMachineIds) as Record<
      string,
      unknown
    >
    return response.created({
      ...presented,
      token: machine.token,
    })
  }

  /**
   * Exibe detalhes de uma máquina (specs + telemetria recente).
   * O token do agente nunca é exposto aqui — apenas em POST (criação) e regenerate-token.
   *
   * GET /api/v1/machines/:id
   */
  async show({ params, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    await machine.load('group')
    const occupiedMachineIds = await buildOccupiedMachineIds()

    return response.ok(
      this.serializeMachineForApi(
        machine,
        telemetryBuffer.getLatest(machine.id),
        occupiedMachineIds
      )
    )
  }

  /**
   * Atualiza uma máquina.
   * Se entrar em manutenção, cancela todas as alocações futuras.
   *
   * PUT /api/v1/machines/:id
   */
  async update({ params, request, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    const data = (await request.validateUsing(updateMachineValidator)) as any

    const wasNotInMaintenance = machine.status !== 'maintenance'
    const isEnteringMaintenance = data.status === 'maintenance'

    const { totalDiskGb, ...updateData } = data
    if (updateData.status !== undefined) {
      updateData.status = normalizeOperationalMode(updateData.status)
    }
    if (updateData.customAgentConfig !== undefined) {
      updateData.customAgentConfig = normalizeCustomAgentConfig(updateData.customAgentConfig)
    }
    machine.merge(updateData)
    await machine.save()

    // Se entrou em manutenção, cancela todas as reservas ativas/pendentes
    let cancelledCount = 0
    if (wasNotInMaintenance && isEnteringMaintenance) {
      cancelledCount = await cancelAllocationsForMaintenance(machine)
    }

    machineCache.invalidateById(machine.id)

    const occupiedMachineIds = await buildOccupiedMachineIds()
    const presented = this.serializeMachineForApi(
      machine,
      telemetryBuffer.getLatest(machine.id),
      occupiedMachineIds
    ) as Record<string, unknown>

    return response.ok({
      ...presented,
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
    const { page = 1, limit = 100 } = request.qs()

    const allocations = await Allocation.query().where('machineId', machine.id).select('id')

    const allocationIds = allocations.map((a) => a.id)

    if (allocationIds.length === 0) {
      return response.ok({
        realtime: this.normalizeTelemetry(telemetryBuffer.getLatest(machine.id)),
        history: { data: [], meta: { total: 0, perPage: limit, currentPage: page } },
      })
    }

    const Telemetry = (await import('#models/telemetry')).default

    const telemetries = await Telemetry.query()
      .whereIn('allocationId', allocationIds)
      .orderBy('id', 'desc')
      .paginate(page, limit)

    const latestRealtime = telemetryBuffer.getLatest(machine.id)

    return response.ok({
      realtime: this.normalizeTelemetry(latestRealtime),
      history: telemetries,
    })
  }

  /**
   * Regenera o token de autenticação de uma máquina.
   *
   * POST /api/v1/machines/:id/regenerate-token
   */
  async regenerateToken({ params, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)

    machineCache.invalidate(machine.token)

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

  /**
   * Retorna as últimas entradas de telemetria do ring buffer para playback.
   *
   * GET /api/v1/machines/:id/telemetry/stream
   */
  async telemetryStream({ params, request, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    const { count } = request.qs()
    const maxCount = count ? Math.min(Number(count), 15) : 15

    const batch = telemetryBuffer.getLastBatch(machine.id, maxCount)
    const normalized = batch
      .map((raw) => this.normalizeTelemetry(raw))
      .filter((e): e is NonNullable<typeof e> => e != null)

    const latestRaw = telemetryBuffer.getLatest(machine.id)
    const latest = this.normalizeTelemetry(latestRaw)

    return response.ok({
      machineId: machine.id,
      batch: normalized,
      /** @deprecated use `batch` — mantido para compatibilidade */
      entries: normalized,
      latest,
      total: normalized.length,
    })
  }

  /**
   * Dispara o gatilho para o Agente reportar processos nos próximos 5 batches.
   * POST /api/v1/machines/:id/request-processes
   */
  async requestProcessReport({ params, request, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)
    const options = await request.validateUsing(requestProcessReportValidator)

    const config = machine.customAgentConfig || {}

    // Salva o timestamp do pedido e os filtros que o admin escolheu na hora
    config.onDemandProcessConfig = {
      requestTimestamp: DateTime.now().toISO(),
      thresholds: {
        cpuPercent: options.cpuPercent ?? 2.0,
        ramMb: options.ramMb ?? 200,
        vramMb: options.vramMb ?? 50,
        diskReadKbps: options.diskReadKbps ?? 1000,
        diskWriteKbps: options.diskWriteKbps ?? 1000,
        topX: options.topX ?? 10,
      },
    }

    machine.customAgentConfig = config
    await machine.save()

    return response.ok({
      message: `Gatilho enviado. Agente coletará o Top ${config.onDemandProcessConfig.thresholds.topX} nos próximos envios.`,
      machineId: machine.id,
    })
  }
}
