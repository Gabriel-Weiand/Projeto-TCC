import vine from '@vinejs/vine'

/**
 * Validator para validação de usuário no agente.
 * O agente envia credenciais do usuário que quer logar na máquina.
 */
export const validateUserValidator = vine.compile(
  vine.object({
    email: vine.string().email().normalizeEmail(),
    password: vine.string().minLength(1),
  })
)

/**
 * Validator para report de login no SO.
 */
export const reportLoginValidator = vine.compile(
  vine.object({
    username: vine.string().trim().maxLength(100),
  })
)

/**
 * Validator para sincronização de specs da máquina.
 * O agente pode atualizar automaticamente as specs detectadas.
 */
export const syncSpecsValidator = vine.compile(
  vine.object({
    cpuModel: vine.string().trim().maxLength(100).optional(),
    gpuModel: vine.string().trim().maxLength(100).optional(),
    totalRamGb: vine.number().positive().max(1024).optional(),
    totalDiskGb: vine.number().positive().max(100000).optional(),
    ipAddress: vine.string().trim().maxLength(45).optional(),
    // macAddress não é sincronizável: é definido na criação e usado na autenticação
  })
)

/**
 * Validator para alocação rápida (quick-allocate).
 * Permite criar uma alocação instantânea diretamente do agente.
 */
export const quickAllocateValidator = vine.compile(
  vine.object({
    email: vine.string().email().normalizeEmail(),
    password: vine.string().minLength(1),
    durationMinutes: vine.number().positive().optional(),
  })
)

/**
 * Validator para report de setup de sessão SSH pelo agente.
 * O agente informa que gerou a chave e a chave privada para entrega ao frontend.
 */
export const sshSetupReportValidator = vine.compile(
  vine.object({
    allocationId: vine.number().positive(),
    systemUsername: vine.string().trim().maxLength(64),
    publicKeyFingerprint: vine.string().trim().maxLength(128),
    privateKey: vine.string().trim().minLength(1),
  })
)

/**
 * Validator para report de teardown de sessão SSH pelo agente.
 */
export const sshTeardownReportValidator = vine.compile(
  vine.object({
    allocationId: vine.number().positive(),
  })
)

/**
 * Validator para atualização de pesos cgroup pelo agente.
 */
export const cgroupReportValidator = vine.compile(
  vine.object({
    systemUsername: vine.string().trim().maxLength(64),
    cpuWeight: vine.number().min(1).max(10000),
    isOwner: vine.boolean(),
  })
)
