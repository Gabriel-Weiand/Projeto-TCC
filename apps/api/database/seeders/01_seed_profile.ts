import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { seedAdminUser } from '../helpers/seed/admin.js'
import { clearLiveTelemetrySeedFile } from '../helpers/seed/cleanup.js'
import { resolveSeedProfile } from '../helpers/seed/profile.js'
import { seedDevAllocations } from '../helpers/seed/allocations_dev.js'
import { seedDevMachines } from '../helpers/seed/machines_dev.js'
import { seedLabMachines } from '../helpers/seed/machines_lab.js'
import { seedDevUsers } from '../helpers/seed/users_dev.js'

export default class extends BaseSeeder {
  async run() {
    const profile = resolveSeedProfile()
    console.log(`\n🌱 Seed profile: ${profile}\n`)

    await seedAdminUser()

    if (profile === 'dev') {
      await seedDevUsers()
      await seedDevMachines()
      await seedDevAllocations()
    } else if (profile === 'lab') {
      clearLiveTelemetrySeedFile()
      await seedLabMachines()
    } else {
      clearLiveTelemetrySeedFile()
    }

    console.log(`✅ Perfil "${profile}" aplicado.\n`)
  }
}
