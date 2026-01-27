import type { HttpContext } from '@adonisjs/core/http'
import { telemetryReportValidator } from '#validators/telemetry'
import { telemetryBuffer } from '#services/telemetry_buffer'

export default class AgentController {
  /**
   * Valida se o agente pode acessar o sistema.
   * Útil para o agente verificar se o token ainda é válido.
   * 
   * POST /api/agent/validate-access
   */
  async validateAccess({ authenticatedMachine, response }: HttpContext) {
    const machine = authenticatedMachine!

    return response.ok({
      valid: true,
      machine: {
        id: machine.id,
        name: machine.name,
        status: machine.status,
      },
    })
  }

  /**
   * Recebe telemetria do agente.
   * Os dados vão para o buffer e são persistidos periodicamente.
   * 
   * POST /api/agent/telemetry
   */
  async report({ authenticatedMachine, request, response }: HttpContext) {
    const machine = authenticatedMachine!
    const data = await request.validateUsing(telemetryReportValidator)

    // Adiciona ao buffer (não vai direto ao banco)
    telemetryBuffer.add({
      machineId: machine.id,
      ...data,
    })

    // Atualiza status da máquina se necessário
    if (machine.status === 'offline') {
      machine.status = 'available'
      await machine.save()
    }

    return response.noContent()
  }
}
