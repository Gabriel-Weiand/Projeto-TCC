import type { HttpContext } from '@adonisjs/core/http'
import { DomainError } from '#services/shared/domain_error'

/**
 * Traduz DomainError para a resposta HTTP adequada.
 * Uso nos controllers:
 *
 *   try {
 *     const result = await SomeService.run(...)
 *     return response.ok(result)
 *   } catch (error) {
 *     if (error instanceof DomainError) return handleDomainError(response, error)
 *     throw error
 *   }
 */
export function handleDomainError(
  response: HttpContext['response'],
  error: DomainError
) {
  const body: Record<string, unknown> = {
    code: error.code,
    message: error.message,
    ...error.details,
  }

  switch (error.status) {
    case 403:
      return response.forbidden(body)
    case 404:
      return response.notFound(body)
    case 409:
      return response.conflict(body)
    case 422:
      return response.unprocessableEntity(body)
    default:
      return response.badRequest(body)
  }
}

export async function runWithDomainError<T>(
  response: HttpContext['response'],
  fn: () => Promise<T>,
  onSuccess: (result: T) => unknown
) {
  try {
    return onSuccess(await fn())
  } catch (error) {
    if (error instanceof DomainError) return handleDomainError(response, error)
    throw error
  }
}
