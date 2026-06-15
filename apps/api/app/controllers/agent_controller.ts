import type { HttpContext } from '@adonisjs/core/http'
import { telemetryReportValidator } from '#validators/telemetry'
import { heartbeatValidator, syncSpecsValidator } from '#validators/agent'
import { AgentHeartbeatService } from '#services/agent/agent_heartbeat'
import { SyncSpecsService } from '#services/agent/sync_specs_service'
import { TelemetryIngestService } from '#services/agent/telemetry_ingest'

export default class AgentController {
  async heartbeat({ authenticatedMachine, request, response }: HttpContext) {
    const payload = await request.validateUsing(heartbeatValidator)
    const result = await AgentHeartbeatService.run(authenticatedMachine!, payload)
    return response.ok(result)
  }

  async syncSpecs({ authenticatedMachine, request, response }: HttpContext) {
    const data = await request.validateUsing(syncSpecsValidator)
    const result = await SyncSpecsService.apply(authenticatedMachine!, data)
    return response.ok(result)
  }

  async telemetry({ authenticatedMachine, request, response }: HttpContext) {
    const body = TelemetryIngestService.normalizeRequestBody(
      request.body() as { data?: Record<string, unknown>[] }
    )
    const { data } = await telemetryReportValidator.validate(body)

    const result = await TelemetryIngestService.ingestBatch(authenticatedMachine!, data)
    if (result.empty) return response.noContent()

    return response.noContent()
  }
}
