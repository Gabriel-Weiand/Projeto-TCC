import type { HttpContext } from '@adonisjs/core/http'
import {
  createMachineValidator,
  updateMachineValidator,
  updateProvisionedUserValidator,
  createProvisionedUserValidator,
} from '#validators/machine'
import { MachineService } from '#services/machine/machine_service'
import { runWithDomainError } from '#controllers/shared/handle_domain_error'

export default class MachinesController {
  /**
   * Lista todas as máquinas.
   *
   * GET /api/v1/machines
   */
  async index({ response }: HttpContext) {
    const machines = await MachineService.listMachines()
    return response.ok(machines)
  }

  /**
   * Cria uma nova máquina.
   * O token é gerado automaticamente pelo Model.
   *
   * POST /api/v1/machines
   */
  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(createMachineValidator)
    const machine = await MachineService.createMachine(data)
    return response.created(machine)
  }

  /**
   * Exibe detalhes de uma máquina (specs + telemetria recente).
   * O token do agente nunca é exposto aqui — apenas em POST (criação) e regenerate-token.
   *
   * GET /api/v1/machines/:id
   */
  async show({ params, response }: HttpContext) {
    const machine = await MachineService.getMachine(Number(params.id))
    return response.ok(machine)
  }

  /**
   * Atualiza uma máquina.
   * Se entrar em manutenção, cancela todas as alocações futuras.
   *
   * PUT /api/v1/machines/:id
   */
  async update({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(updateMachineValidator)

    return runWithDomainError(
      response,
      () => MachineService.updateMachine(Number(params.id), data),
      (result) => response.ok(result)
    )
  }

  /**
   * Remove uma máquina (duas fases).
   *
   * DELETE /api/v1/machines/:id
   */
  async destroy({ params, response }: HttpContext) {
    const result = await MachineService.deleteMachine(Number(params.id))

    if (result.decommissioning) {
      return response.accepted({
        status: result.status,
        message: result.message,
        cancelledAllocations: result.cancelledAllocations,
      })
    }

    return response.noContent()
  }

  /**
   * Retorna histórico de telemetria de uma máquina.
   *
   * GET /api/v1/machines/:id/telemetry
   */
  async telemetry({ params, request, response }: HttpContext) {
    const { page = 1, limit = 100 } = request.qs()
    const result = await MachineService.getMachineTelemetry(
      Number(params.id),
      Number(page),
      Number(limit)
    )
    return response.ok(result)
  }

  /**
   * Regenera o token de autenticação de uma máquina.
   *
   * POST /api/v1/machines/:id/regenerate-token
   */
  async regenerateToken({ params, response }: HttpContext) {
    const result = await MachineService.regenerateToken(Number(params.id))
    return response.ok(result)
  }

  /**
   * Retorna as últimas entradas de telemetria do ring buffer para playback.
   *
   * GET /api/v1/machines/:id/telemetry/stream
   */
  async telemetryStream({ params, request, response }: HttpContext) {
    const { count } = request.qs()
    const result = await MachineService.getTelemetryStream(
      Number(params.id),
      count ? Number(count) : undefined
    )
    return response.ok(result)
  }

  /**
   * Inventário lab.* provisionado nesta máquina (admin).
   * GET /api/v1/machines/:id/provisioned-users
   */
  async provisionedUsers({ params, response }: HttpContext) {
    const rows = await MachineService.listProvisionedUsers(Number(params.id))
    return response.ok(rows)
  }

  /**
   * Vincula usuário à máquina com acesso fixo (shell | sftp | revoked).
   * POST /api/v1/machines/:id/provisioned-users
   */
  async storeProvisionedUser({ params, request, response }: HttpContext) {
    const { userId, accessType } = await request.validateUsing(createProvisionedUserValidator)

    return runWithDomainError(
      response,
      () =>
        MachineService.createProvisionedUser(
          Number(params.id),
          userId,
          accessType ?? 'shell'
        ),
      (rows) => response.created(rows)
    )
  }

  /**
   * Altera access_type do vínculo machine_users (auto | shell | sftp | revoked).
   * PATCH /api/v1/machines/:id/provisioned-users/:userId
   */
  async updateProvisionedUser({ params, request, response }: HttpContext) {
    const { accessType } = await request.validateUsing(updateProvisionedUserValidator)
    const rows = await MachineService.updateProvisionedUser(
      Number(params.id),
      Number(params.userId),
      accessType ?? 'auto'
    )
    return response.ok(rows)
  }

  /**
   * Remove registro machine_users (bloqueado se alocação ainda exige acesso).
   * DELETE /api/v1/machines/:id/provisioned-users/:userId
   */
  async destroyProvisionedUser({ params, response }: HttpContext) {
    return runWithDomainError(
      response,
      () =>
        MachineService.deleteProvisionedUser(Number(params.id), Number(params.userId)),
      () => response.noContent()
    )
  }
}
