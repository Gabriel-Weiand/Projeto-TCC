import Machine from '#models/machine'

declare module '@adonisjs/core/http' {
  interface HttpContext {
    authenticatedMachine?: Machine
  }
}
