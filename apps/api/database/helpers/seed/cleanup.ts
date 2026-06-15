import { existsSync, unlinkSync } from 'node:fs'
import app from '@adonisjs/core/services/app'

const LIVE_TELEMETRY_SEED = 'storage/lab/live_telemetry_seed.json'

/** Remove artefatos de telemetria ao vivo usados só no perfil dev. */
export function clearLiveTelemetrySeedFile() {
  const path = app.makePath(LIVE_TELEMETRY_SEED)
  if (!existsSync(path)) return
  unlinkSync(path)
  console.log('  ↳ Removido storage/lab/live_telemetry_seed.json')
}
