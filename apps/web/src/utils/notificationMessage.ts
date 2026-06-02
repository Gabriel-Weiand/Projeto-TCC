/** Marcadores internos da API para deduplicação — não exibir ao usuário. */
const INTERNAL_REF_RE = /\[(?:alloc|machine)#\d+#\]\s*/g;

export function displayNotificationMessage(message: string): string {
  return message.replace(INTERNAL_REF_RE, "").trim();
}
