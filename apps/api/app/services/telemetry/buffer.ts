import Telemetry from '#models/telemetry'
import { idleTelemetryBuffer } from '#services/telemetry/idle_buffer'
import logger from '@adonisjs/core/services/logger'

/** * Payload unificado de telemetria enviado pelo agente (C2).
 * Mapeia exatamente os campos do schema da base de dados e do validator.
 */
export interface TelemetryPayload {
  allocationId: number
  timestamp: string

  // CPU e GPU — null = métrica não coletada nesta amostra
  cpuUsage?: number | null
  cpuTemp?: number | null
  cpuFreqMhz?: number | null
  gpuUsage?: number | null
  gpuTemp?: number | null
  gpuPowerWatts?: number | null
  vramTotalMb?: number | null
  vramUsedMb?: number | null

  // Memória e Swap
  ramTotalGb?: number | null
  ramUsedGb?: number | null
  swapTotalGb?: number | null
  swapUsedGb?: number | null

  // Discos e I/O
  disks?: any[] | null
  diskReadMbps?: number | null
  diskWriteMbps?: number | null

  // Rede (Mbps)
  downloadMbps?: number | null
  uploadMbps?: number | null

  // Extras
  moboTemperature?: number | null

  // Lista de utilizadores ativos (substitui o antigo loggedUserName)
  activeUsers?: any[] | null

  /** Top processos capturados nesta amostra (wire format). */
  processes?: any[] | null
}

// Alias para compatibilidade interna
type TelemetryData = TelemetryPayload

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
/** Máximo de amostras por lote do agente e no snapshot exposto ao dashboard. */
export const TELEMETRY_AGENT_BATCH_MAX = 15

class TelemetryBuffer {
  private buffer: TelemetryData[] = []
  private latestState = new Map<number, MachineLatestState>()
  private recentEntries = new Map<number, TelemetryData[]>()
  /** Último lote completo recebido do agente (para diff no frontend). */
  private lastBatchByMachine = new Map<number, TelemetryData[]>()
  private readonly MAX_RECENT_ENTRIES = TELEMETRY_AGENT_BATCH_MAX

  private readonly FLUSH_INTERVAL_MS = 60 * 1000
  private readonly MAX_BUFFER_SIZE = 1000

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
    this.latestState.set(machineId, {
      data,
      receivedAt: Date.now(),
    })

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
    this.updateRealtime(machineId, data)
    this.buffer.push(data)

    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.flush()
    }
  }

  /**
   * Guarda o último lote enviado pelo agente (até 15 amostras).
   * Usado pelo stream HTTP para o front comparar lote a lote.
   */
  recordBatch(machineId: number, batch: TelemetryData[]): void {
    if (batch.length === 0) return
    const capped =
      batch.length > TELEMETRY_AGENT_BATCH_MAX
        ? batch.slice(-TELEMETRY_AGENT_BATCH_MAX)
        : [...batch]
    this.lastBatchByMachine.set(machineId, capped)
  }

  getLatest(machineId: number): TelemetryData | null {
    return this.latestState.get(machineId)?.data ?? null
  }

  /**
   * Último lote do agente; se ainda não houve POST em lote, usa o ring (máx. 15).
   */
  getLastBatch(machineId: number, count?: number): TelemetryData[] {
    const max = Math.min(
      count ?? TELEMETRY_AGENT_BATCH_MAX,
      TELEMETRY_AGENT_BATCH_MAX
    )
    const batch = this.lastBatchByMachine.get(machineId)
    if (batch && batch.length > 0) {
      return batch.length > max ? batch.slice(-max) : [...batch]
    }
    return this.getRecent(machineId, max)
  }

  /**
   * Retorna as últimas entradas do ring buffer de uma máquina.
   * @param machineId - ID da máquina
   * @param count - Número máximo de entradas (default: todas disponíveis, máx. 15 no ring)
   */
  getRecent(machineId: number, count?: number): TelemetryData[] {
    const ring = this.recentEntries.get(machineId)
    if (!ring || ring.length === 0) return []
    const cap = Math.min(count ?? ring.length, TELEMETRY_AGENT_BATCH_MAX)
    if (cap < ring.length) {
      return ring.slice(-cap)
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
      // Batch insert em chunks para evitar limites de variáveis do SQLite
      const CHUNK = 200
      let inserted = 0

      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK)
        await Telemetry.createMany(chunk)
        inserted += chunk.length
      }

      logger.info(`[TelemetryBuffer] Flushed ${inserted} records`)
      return inserted
    } catch (error) {
      // Em caso de erro, devolve apenas os registros não inseridos para retry
      // (assume que falha ocorreu antes de inserir todos os chunks)
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
    this.lastBatchByMachine.delete(machineId)
    idleTelemetryBuffer.clearMachine(machineId)
  }

  /**
   * Descarta todos os dados pendentes e limpa o estado real-time.
   * Usar apenas em testes para evitar contaminação entre cenários.
   */
  reset(): void {
    this.buffer = []
    this.latestState.clear()
    this.recentEntries.clear()
    this.lastBatchByMachine.clear()
    idleTelemetryBuffer.reset()
  }
}

// Singleton
export const telemetryBuffer = new TelemetryBuffer()
