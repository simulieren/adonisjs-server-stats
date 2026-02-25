import type { StatsEngine } from '../engine/stats_engine.js'
import type { HttpContext } from '@adonisjs/core/http'

export default class ServerStatsController {
  constructor(private engine: StatsEngine) {}

  async index({ response }: HttpContext) {
    const stats = this.engine.getLatestStats()
    return response.json(stats)
  }
}
