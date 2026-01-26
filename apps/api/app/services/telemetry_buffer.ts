import Telemetry from '#models/telemetry'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

interface TelemetryData {
  machineId: number
  cpuUsage: number
  cpuTemp: number
  gpuUsage: number
  gpuTemp: number
  ramUsage: number
  diskUsage: number
  downloadUsage: number
  uploadUsage: number
  moboTemperature?: number | null
  loggedUserName?: string | null
  createdAt: DateTime
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
 */
class TelemetryBuffer {
  // Buffer de telemetrias pendentes para insert
  private buffer: TelemetryData[] = []

  // Estado mais recente de cada máquina (para dashboard real-time)
  private latestState = new Map<number, MachineLatestState>()

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
   * Adiciona telemetria ao buffer e atualiza estado mais recente.
   */
  add(data: Omit<TelemetryData, 'createdAt'>): void {
    const telemetry: TelemetryData = {
      ...data,
      createdAt: DateTime.now(),
    }

    // Adiciona ao buffer para persistência
    this.buffer.push(telemetry)

    // Atualiza estado mais recente da máquina (para dashboard)
    this.latestState.set(data.machineId, {
      data: telemetry,
      receivedAt: Date.now(),
    })

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
      flushIntervalSeconds: this.FLUSH_INTERVAL_MS / 1000,
      maxBufferSize: this.MAX_BUFFER_SIZE,
    }
  }

  /**
   * Limpa estado de uma máquina (usar ao deletar máquina).
   */
  clearMachine(machineId: number): void {
    this.latestState.delete(machineId)
    this.buffer = this.buffer.filter((t) => t.machineId !== machineId)
  }
}

// Singleton
export const telemetryBuffer = new TelemetryBuffer()
