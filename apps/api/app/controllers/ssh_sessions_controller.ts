import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import SshSession from '#models/ssh_session'
import { sshKeyStore } from '#controllers/agent_controller'

export default class SshSessionsController {
  /**
   * Lista sessões SSH ativas ou recentes.
   * Filtros opcionais: machineId, userId, status.
   *
   * GET /api/v1/ssh-sessions
   */
  async index({ request, response }: HttpContext) {
    const { machineId, userId, status } = request.qs()

    let query = SshSession.query()
      .preload('machine')
      .preload('user')
      .preload('allocation')
      .orderBy('createdAt', 'desc')
      .limit(100)

    if (machineId) query = query.where('machineId', machineId)
    if (userId) query = query.where('userId', userId)
    if (status) query = query.where('status', status)

    const sessions = await query

    return response.ok(
      sessions.map((s) => ({
        id: s.id,
        allocationId: s.allocationId,
        machineId: s.machineId,
        machineName: s.machine?.name ?? null,
        userId: s.userId,
        userName: s.user?.fullName ?? null,
        systemUsername: s.systemUsername,
        publicKeyFingerprint: s.publicKeyFingerprint,
        status: s.status,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt ?? null,
      }))
    )
  }

  /**
   * Revoga uma sessão SSH imediatamente (admin).
   * A revogação é detectada pelo agente no próximo polling de ssh/pending (~5s).
   *
   * DELETE /api/v1/ssh-sessions/:id
   */
  async destroy({ params, response }: HttpContext) {
    const session = await SshSession.findOrFail(params.id)

    if (session.status !== 'active') {
      return response.badRequest({
        code: 'SESSION_NOT_ACTIVE',
        message: `Sessão já está com status '${session.status}'.`,
      })
    }

    // Marca como revogada mas deixa revokedAt como null
    // Isso sinaliza para o ssh/pending que o agente ainda não processou a revogação.
    // O agente preenche revokedAt ao confirmar via ssh/teardown.
    session.status = 'revoked'
    await session.save()

    // Remove a chave privada da memória se ainda estiver lá
    sshKeyStore.delete(session.id)

    return response.ok({
      success: true,
      sessionId: session.id,
      message: 'Sessão marcada para revogação. O agente irá remover a chave em até 5 segundos.',
    })
  }
}
