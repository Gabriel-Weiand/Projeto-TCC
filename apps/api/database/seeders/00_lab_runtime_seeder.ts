import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { resetLabRuntimeSettingsToAuto } from '#services/lab/runtime_settings'

export default class extends BaseSeeder {
  async run() {
    resetLabRuntimeSettingsToAuto()
  }
}
