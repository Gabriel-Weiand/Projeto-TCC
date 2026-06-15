import type { HttpContext } from '@adonisjs/core/http'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import {
  createMachineValidator,
  updateMachineValidator,
  updateProvisionedUserValidator,
  createProvisionedUserValidator,
} from '#validators/machine'
import {
  createMachineUser,
  deleteMachineUser,
  listMachineProvisionedUsers,
  updateMachineUserAccessType,
} from '#services/machine_provisioned_users'
import { telemetryBuffer } from '#services/telemetry_buffer'
import { idleTelemetryBuffer } from '#services/telemetry_idle_buffer'
import { normalizeChartSeriesPoint } from '#services/telemetry_api_format'
import { machineCache } from '#services/machine_cache'
import { cancelAllocationsForMaintenance } from '#services/notification_service'
import { normalizeCustomAgentConfig } from '#services/telemetry_presets'
import { normalizeRealtimeTelemetry } from '#services/telemetry_normalize'
import { enrichDiskPartitions, mergeAdminDiskPolicyUpdate, validateMachineDiskPolicy } from '#services/disk_partitions'
import {
  buildOccupiedMachineIds,
  normalizeOperationalMode,
  resolveEffectiveMachineStatus,
} from '#services/machine_effective_status'
import {
  finalizeMachineDeletion,
  isMachinePendingRemoval,
  prepareMachineDecommission,
} from '#services/machine_decommission'
import { normalizeAdminMachineWireFields } from '#services/machine_specs_merge'

export default class MachinesController {
  /** Agente envia GB×10; respostas HTTP ao front em GB (1 decimal). */
  private agentGbToApi(wire: number | null | undefined): number | null {
    if (wire == null) return null
    return Number(wire) / 10
  }

  private normalizeTelemetry(raw: unknown) {
    return normalizeRealtimeTelemetry(raw)
  }

  /** Partições vindas do agente (JSON) — id estável para keys no front. */
  private mapMachineDisks(disks: unknown) {
    return enrichDiskPartitions(disks).map((d, index) => ({
      id: index,
      device: d.device,
      mountpoint: d.mountpoint,
      fstype: d.fstype ?? null,
      totalGb: d.totalGb ?? null,
      freeGb: d.freeGb ?? null,
      usagePct: d.usagePct ?? null,
      role: d.role ?? 'user',
      mainDisk: Boolean(d.mainDisk),
      allocatable: d.role === 'user' ? d.allocatable !== false : false,
    }))
  }

  private resolveParkTelemetry(machineId: number) {
    const live = telemetryBuffer.getLatest(machineId)
    if (live) return live
    return idleTelemetryBuffer.getLatestEntry(machineId)?.metrics ?? null
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
      totalDiskGb: this.agentGbToApi(machine.totalDiskGb),
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
        this.resolveParkTelemetry(machine.id),
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
    const data = (await request.validateUsing(createMachineValidator)) as Record<string, unknown>
    normalizeAdminMachineWireFields(data)

    const machine = await Machine.create(data)

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
        this.resolveParkTelemetry(machine.id),
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
    const data = (await request.validateUsing(updateMachineValidator)) as Record<string, unknown>
    normalizeAdminMachineWireFields(data)

    const wasNotInMaintenance = machine.status !== 'maintenance'
    const isEnteringMaintenance = data.status === 'maintenance'

    const updateData = data as any
    if (updateData.status !== undefined) {
      updateData.status = normalizeOperationalMode(updateData.status)
    }
    if (updateData.customAgentConfig !== undefined) {
      updateData.customAgentConfig = normalizeCustomAgentConfig(updateData.customAgentConfig)
    }
    if (updateData.disks !== undefined) {
      updateData.disks = mergeAdminDiskPolicyUpdate(updateData.disks, machine.disks)
    }
    const onlyMainDisk =
      updateData.onlyMainDisk !== undefined ? Boolean(updateData.onlyMainDisk) : machine.onlyMainDisk
    if (updateData.disks !== undefined) {
      const policyError = validateMachineDiskPolicy(updateData.disks, onlyMainDisk)
      if (policyError) {
        return response.unprocessableEntity({ message: policyError })
      }
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
      this.resolveParkTelemetry(machine.id),
      occupiedMachineIds
    ) as Record<string, unknown>

    return response.ok({
      ...presented,
      cancelledAllocations: cancelledCount > 0 ? cancelledCount : undefined,
    })
  }

  /**
   * Remove uma máquina (duas fases).
   *
   * 1ª chamada: descomissiona (cancela reservas, limpa machine_users, pendingRemoval).
   *    O agente recebe `decommission: true` no heartbeat e remove lab.* em todas as partições.
   * 2ª chamada: apaga o registro no banco.
   *
   * DELETE /api/v1/machines/:id
   */
  async destroy({ params, response }: HttpContext) {
    const machine = await Machine.findOrFail(params.id)

    if (!isMachinePendingRemoval(machine)) {
      const cancelledCount = await prepareMachineDecommission(machine)
      machineCache.invalidateById(machine.id)
      machineCache.invalidate(machine.token)

      return response.accepted({
        status: 'decommissioning',
        message:
          'Máquina marcada para descomissionamento. O agente removerá usuários lab.* na próxima sincronização (~30s). Repita a exclusão para remover o registro.',
        cancelledAllocations: cancelledCount > 0 ? cancelledCount : undefined,
      })
    }

    await finalizeMachineDeletion(machine)

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
      const idleChartRaw = idleTelemetryBuffer.getChartSeries(machine.id)
      const idleMeta = idleTelemetryBuffer.getMeta(machine.id)
      const normalizedChart = idleChartRaw.map((p) =>
        normalizeChartSeriesPoint(p as unknown as Record<string, unknown>)
      )
      return response.ok({
        realtime: this.normalizeTelemetry(telemetryBuffer.getLatest(machine.id)),
        idleHistory: {
          points: normalizedChart,
          chartSeries: normalizedChart,
          meta: idleMeta,
        },
        history: { data: [], meta: { total: 0, perPage: limit, currentPage: page } },
      })
    }

    const Telemetry = (await import('#models/telemetry')).default

    const telemetries = await Telemetry.query()
      .whereIn('allocationId', allocationIds)
      .orderBy('id', 'desc')
      .paginate(page, limit)

    const latestRealtime = telemetryBuffer.getLatest(machine.id)
    const idleChartRaw = idleTelemetryBuffer.getChartSeries(machine.id)
    const idleMeta = idleTelemetryBuffer.getMeta(machine.id)
    const normalizedChart = idleChartRaw.map((p) =>
      normalizeChartSeriesPoint(p as unknown as Record<string, unknown>)
    )

    return response.ok({
      realtime: this.normalizeTelemetry(latestRealtime),
      idleHistory: {
        points: normalizedChart,
        chartSeries: normalizedChart,
        meta: idleMeta,
      },
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
   * Inventário lab.* provisionado nesta máquina (admin).
   * GET /api/v1/machines/:id/provisioned-users
   */
  async provisionedUsers({ params, response }: HttpContext) {
    const rows = await listMachineProvisionedUsers(params.id)
    return response.ok(rows)
  }

  /**
   * Vincula usuário à máquina com acesso fixo (shell | sftp | revoked).
   * POST /api/v1/machines/:id/provisioned-users
   */
  async storeProvisionedUser({ params, request, response }: HttpContext) {
    const { userId, accessType } = await request.validateUsing(createProvisionedUserValidator)

    try {
      const rows = await createMachineUser(params.id, userId, accessType ?? 'shell')
      return response.created(rows)
    } catch (error) {
      if (error instanceof Error && error.message === 'USER_WITHOUT_SYSTEM_USERNAME') {
        return response.badRequest({
          code: 'USER_WITHOUT_SYSTEM_USERNAME',
          message: 'O usuário não possui system_username cadastrado.',
        })
      }
      if (error instanceof Error && error.message === 'ALREADY_PROVISIONED') {
        return response.conflict({
          code: 'ALREADY_PROVISIONED',
          message: 'Este usuário já está vinculado a esta máquina.',
        })
      }
      throw error
    }
  }

  /**
   * Altera access_type do vínculo machine_users (auto | shell | sftp | revoked).
   * PATCH /api/v1/machines/:id/provisioned-users/:userId
   */
  async updateProvisionedUser({ params, request, response }: HttpContext) {
    const { accessType } = await request.validateUsing(updateProvisionedUserValidator)
    const rows = await updateMachineUserAccessType(
      params.id,
      params.userId,
      accessType ?? 'auto'
    )
    return response.ok(rows)
  }

  /**
   * Remove registro machine_users (bloqueado se alocação ainda exige acesso).
   * DELETE /api/v1/machines/:id/provisioned-users/:userId
   */
  async destroyProvisionedUser({ params, response }: HttpContext) {
    try {
      await deleteMachineUser(params.id, params.userId)
      return response.noContent()
    } catch (error) {
      if (error instanceof Error && error.message === 'ACTIVE_ALLOCATION') {
        return response.conflict({
          code: 'ACTIVE_ALLOCATION',
          message:
            'Não é possível remover usuário com alocação ativa nesta máquina. Finalize ou cancele a reserva primeiro.',
        })
      }
      throw error
    }
  }
}
