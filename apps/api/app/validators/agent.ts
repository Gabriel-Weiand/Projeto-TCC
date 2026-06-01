import vine from '@vinejs/vine'

/**
 * Schema para as tentativas de SSH reportadas pelo Agente
 */
const sshAttemptSchema = vine.object({
  sourceIp: vine.string().trim().maxLength(45),
  targetUsername: vine.string().trim().maxLength(64),
  status: vine.enum(['success', 'failed', 'invalid_user'] as const),
  authMethod: vine.string().trim().maxLength(50).nullable().optional(),
  clientFingerprint: vine.string().trim().maxLength(128).nullable().optional(),
})

/**
 * Validator para o heartbeat do agente.
 * O agente envia a lista de usuários atualmente conectados via SSH (lida via `who -q` / utmp).
 */
export const heartbeatValidator = vine.compile(
  vine.object({
    // Usuários online naquele exato segundo
    connectedUsers: vine.array(vine.string().trim().maxLength(64)).optional(),

    // Lista de usuários reais detectados no SO (Drift Detection)
    provisionedOsUsers: vine.array(vine.string().trim().maxLength(64)).optional(),

    // Auditoria de acessos SSH desde o último heartbeat (máximo 50 para evitar travamento do banco)
    sshAttempts: vine.array(sshAttemptSchema).maxLength(50).optional(),
  })
)

/**
 * Validador de item de disco/partição enviado pelo agente no sync-specs.
 */
const diskItemSchema = vine.object({
  device: vine.string().trim().maxLength(128),
  mountpoint: vine.string().trim().maxLength(255),
  fstype: vine.string().trim().maxLength(32).optional(),
  totalGb: vine.number().min(0).max(100000).optional().nullable(),
  freeGb: vine.number().min(0).max(100000).optional().nullable(),
})

/**
 * Validator para sincronização de specs da máquina.
 * O agente pode atualizar automaticamente as specs detectadas.
 */
export const syncSpecsValidator = vine.compile(
  vine.object({
    cpuModel: vine.string().trim().maxLength(100).optional(),
    gpuModel: vine.string().trim().maxLength(100).optional(),
    totalRamGb: vine.number().positive().max(1024).optional(),
    ipAddress: vine.string().trim().maxLength(45).optional(),
    disks: vine.array(diskItemSchema).maxLength(32).optional(),
    hostFingerprint: vine.string().maxLength(255).nullable().optional(),
  })
)
