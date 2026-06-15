export type DomainErrorStatus = 400 | 403 | 404 | 409 | 422

/**
 * Erro de domínio lançado pelos services.
 * O HttpExceptionHandler traduz automaticamente para o status HTTP correspondente.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: DomainErrorStatus = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError
}
