import Machine from '#models/machine'

interface CachedMachine {
  machine: Machine
  cachedAt: number
}

/**
 * Cache simples em memória para máquinas autenticadas.
 * Evita queries repetidas ao banco em cada request de telemetria.
 */
class MachineCache {
  private cache = new Map<string, CachedMachine>()
  private readonly TTL_MS = 5 * 60 * 1000 // 5 minutos

  /**
   * Busca máquina pelo token, usando cache quando disponível.
   */
  async getByToken(token: string): Promise<Machine | null> {
    const cached = this.cache.get(token)

    // Cache hit e ainda válido
    if (cached && Date.now() - cached.cachedAt < this.TTL_MS) {
      return cached.machine
    }

    // Cache miss ou expirado - busca no banco
    const machine = await Machine.findBy('token', token)

    if (machine) {
      this.cache.set(token, {
        machine,
        cachedAt: Date.now(),
      })
    } else {
      // Remove entrada inválida do cache
      this.cache.delete(token)
    }

    return machine
  }

  /**
   * Invalida cache de uma máquina específica (usar ao deletar/atualizar token).
   */
  invalidate(token: string): void {
    this.cache.delete(token)
  }

  /**
   * Invalida cache pelo ID da máquina (útil quando não temos o token).
   */
  invalidateById(machineId: number): void {
    for (const [token, { machine }] of this.cache.entries()) {
      if (machine.id === machineId) {
        this.cache.delete(token)
        break
      }
    }
  }

  /**
   * Limpa todo o cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Retorna estatísticas do cache (útil para debug/monitoramento).
   */
  stats() {
    return {
      size: this.cache.size,
      ttlMinutes: this.TTL_MS / 60000,
    }
  }
}

// Singleton - única instância compartilhada
export const machineCache = new MachineCache()
