import type Machine from '#models/machine'
import HeartbeatService from '#services/agent/heartbeat_service'
import { updateMachinePresence } from '#services/agent/presence'
import type { Infer } from '@vinejs/vine/types'
import type { heartbeatValidator } from '#validators/agent'

type HeartbeatPayload = Infer<typeof heartbeatValidator>

const heartbeatService = new HeartbeatService()

export const AgentHeartbeatService = {
  async run(machine: Machine, payload: HeartbeatPayload) {
    const responseData = await heartbeatService.processHeartbeat(machine, payload)
    await updateMachinePresence(machine, {
      connectedUsers: payload.connectedUsers ?? [],
    })
    return responseData
  },
}
