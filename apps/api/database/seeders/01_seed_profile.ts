import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { seedAdminUser } from '../helpers/seed/admin.js'
import { clearLiveTelemetrySeedFile } from '../helpers/seed/cleanup.js'
import { resolveSeedProfile } from '../helpers/seed/profile.js'
import { seedParkAllocations } from '../helpers/seed/allocations_dev.js'
import { seedParkMachines } from '../helpers/seed/machines_dev.js'
import { seedDevUsers } from '../helpers/seed/users_dev.js'

export default class extends BaseSeeder {
  async run() {
    const profile = resolveSeedProfile()
    console.log(`\n🌱 Seed profile: ${profile}\n`)

    await seedAdminUser()

    // dev e lab compartilham o mesmo parque completo; a única diferença é o
    // Notebook-server, que existe apenas em dev.
    if (profile === 'dev' || profile === 'lab') {
      await seedDevUsers()
      await seedParkMachines({ includeNotebookServer: profile === 'dev' })
      await seedParkAllocations()
    } else {
      clearLiveTelemetrySeedFile()
    }

    console.log(`✅ Perfil "${profile}" aplicado.\n`)
  }
}
