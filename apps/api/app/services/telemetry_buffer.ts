import Telemetry from '#models/telemetry'
import logger from '@adonisjs/core/services/logger'

interface TelemetryData {
  allocationId: number
  cpuUsage: number
  cpuTemp: number
  gpuUsage: number
  gpuTemp: number
  ramUsage: number
  diskUsage?: number | null
  downloadUsage?: number | null
  uploadUsage?: number | null
  moboTemperature?: number | null
  loggedUserName: string
}

interface MachineLatestState {
  data: TelemetryData
  receivedAt: number
}

/**
 * Buffer de telemetria para otimizar writes no banco.
 *
 * - Acumula telemetrias em memória
 * - Faz batch insert periodicamente
 * - Mantém estado mais recente para consulta imediata (dashboard)
 * - Mantém ring buffer de entradas recentes por máquina (para playback 1/s no frontend)
 *
 * O estado real-time é indexado por machineId para fácil acesso do dashboard,
 * enquanto a persistência usa allocationId como FK.
 */
class TelemetryBuffer {
  // Buffer de telemetrias pendentes para insert
  private buffer: TelemetryData[] = []

  // Estado mais recente de cada máquina (para dashboard real-time)
  // Chave: machineId (resolvido externamente pelo controller)
  private latestState = new Map<number, MachineLatestState>()

  // Ring buffer de entradas recentes por máquina (para playback no frontend)
  // Mantém as últimas MAX_RECENT_ENTRIES por máquina
  private recentEntries = new Map<number, TelemetryData[]>()
  private readonly MAX_RECENT_ENTRIES = 30

  // Configurações
  // Agente envia a cada 5s → 12 registros/min por máquina
  // Flush a cada 60s → ~120 registros por flush (10 máquinas)
  private readonly FLUSH_INTERVAL_MS = 60 * 1000 // 60 segundos
  private readonly MAX_BUFFER_SIZE = 1000 // Flush forçado se exceder

  // Timer do flush periódico
  private flushTimer: NodeJS.Timeout | null = null
  private isFlushing = false

  constructor() {
    this.startPeriodicFlush()
  }

  /**
   * Atualiza estado real-time da máquina (latestState + ring buffer).
   * Chamado SEMPRE que o agente envia telemetria, independente de alocação.
   * @param machineId - ID da máquina
   * @param data - Dados da telemetria (pode ter allocationId 0 se sem alocação)
   */
  updateRealtime(machineId: number, data: TelemetryData): void {
    // Atualiza estado mais recente da máquina (para dashboard)
    this.latestState.set(machineId, {
      data,
      receivedAt: Date.now(),
    })

    // Adiciona ao ring buffer da máquina (para playback no frontend)
    let ring = this.recentEntries.get(machineId)
    if (!ring) {
      ring = []
      this.recentEntries.set(machineId, ring)
    }
    ring.push(data)
    if (ring.length > this.MAX_RECENT_ENTRIES) {
      ring.shift()
    }
  }

  /**
   * Adiciona telemetria ao buffer de persistência (para batch insert no banco).
   * Chamado apenas quando há alocação ativa.
   * Também atualiza o estado real-time.
   * @param machineId - ID da máquina
   * @param data - Dados da telemetria com allocationId válido
   */
  add(machineId: number, data: TelemetryData): void {
    // Atualiza estado real-time
    this.updateRealtime(machineId, data)

    // Adiciona ao buffer para persistência
    this.buffer.push(data)

    // Flush forçado se buffer muito grande
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.flush()
    }
  }

  /**
   * Retorna o estado mais recente de uma máquina (sem ir ao banco).
   * Útil para dashboard real-time.
   */
  getLatest(machineId: number): TelemetryData | null {
    return this.latestState.get(machineId)?.data ?? null
  }

  /**
   * Retorna as últimas entradas do ring buffer de uma máquina.
   * Usado pelo frontend para playback de telemetria 1/s.
   * @param machineId - ID da máquina
   * @param count - Número máximo de entradas (default: todas disponíveis)
   */
  getRecent(machineId: number, count?: number): TelemetryData[] {
    const ring = this.recentEntries.get(machineId)
    if (!ring || ring.length === 0) return []
    if (count && count < ring.length) {
      return ring.slice(-count)
    }
    return [...ring]
  }

  /**
   * Retorna estado mais recente de todas as máquinas.
   */
  getAllLatest(): Map<number, TelemetryData> {
    const result = new Map<number, TelemetryData>()
    for (const [machineId, state] of this.latestState.entries()) {
      result.set(machineId, state.data)
    }
    return result
  }

  /**
   * Persiste buffer no banco de dados.
   */
  async flush(): Promise<number> {
    if (this.isFlushing || this.buffer.length === 0) {
      return 0
    }

    this.isFlushing = true

    // Pega os dados e limpa o buffer atomicamente
    const toInsert = [...this.buffer]
    this.buffer = []

    try {
      // Batch insert - muito mais eficiente que inserts individuais
      await Telemetry.createMany(toInsert)

      logger.info(`[TelemetryBuffer] Flushed ${toInsert.length} records`)
      return toInsert.length
    } catch (error) {
      // Em caso de erro, devolve ao buffer para retry
      this.buffer = [...toInsert, ...this.buffer]
      logger.error('[TelemetryBuffer] Flush failed, data returned to buffer', error)
      throw error
    } finally {
      this.isFlushing = false
    }
  }

  /**
   * Inicia flush periódico.
   */
  private startPeriodicFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error('[TelemetryBuffer] Periodic flush error', err)
      })
    }, this.FLUSH_INTERVAL_MS)

    // Não bloqueia o shutdown do processo
    this.flushTimer.unref()
  }

  /**
   * Para o flush periódico e persiste dados pendentes.
   * Chamar no shutdown da aplicação.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // Flush final
    if (this.buffer.length > 0) {
      await this.flush()
    }
  }

  /**
   * Estatísticas do buffer.
   */
  stats() {
    return {
      pendingRecords: this.buffer.length,
      machinesTracked: this.latestState.size,
      recentBufferMachines: this.recentEntries.size,
      maxRecentEntries: this.MAX_RECENT_ENTRIES,
      flushIntervalSeconds: this.FLUSH_INTERVAL_MS / 1000,
      maxBufferSize: this.MAX_BUFFER_SIZE,
    }
  }

  /**
   * Limpa estado real-time de uma máquina (usar ao deletar máquina).
   * Os dados pendentes no buffer serão persistidos normalmente no próximo flush.
   */
  clearMachine(machineId: number): void {
    this.latestState.delete(machineId)
    this.recentEntries.delete(machineId)
  }

  /**
   * Descarta todos os dados pendentes e limpa o estado real-time.
   * Usar apenas em testes para evitar contaminação entre cenários.
   */
  reset(): void {
    this.buffer = []
    this.latestState.clear()
    this.recentEntries.clear()
  }
}

// Singleton
export const telemetryBuffer = new TelemetryBuffer()
