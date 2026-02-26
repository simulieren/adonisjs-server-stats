import { log } from '../utils/logger.js'
import { LogStreamService } from './log_stream_service.js'

import type { ApplicationService } from '@adonisjs/core/types'

export default class LogStreamProvider {
  private service: LogStreamService | null = null

  constructor(protected app: ApplicationService) {}

  async ready() {
    if (this.app.inTest) return

    let transmit: any
    try {
      transmit = await this.app.container.make('transmit')
    } catch {
      log.info('@adonisjs/transmit not available — live log streaming disabled')
      return
    }

    const logPath = this.app.makePath('logs', 'adonisjs.log')
    const channelName = this.app.config.get<string>('server_stats.logChannelName', 'admin/logs')

    this.service = new LogStreamService(logPath, (entry) => {
      try {
        transmit.broadcast(channelName, JSON.parse(JSON.stringify(entry)))
      } catch {
        // Silently ignore broadcast errors
      }
    })

    await this.service.start()
  }

  async shutdown() {
    this.service?.stop()
  }
}
