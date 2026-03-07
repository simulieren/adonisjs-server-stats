import { getLogStreamService } from '../collectors/log_collector.js'
import { log } from '../utils/logger.js'
import { LogStreamService } from './log_stream_service.js'

import type { ApplicationService } from '@adonisjs/core/types'

/** Minimal interface for the @adonisjs/transmit broadcast service. */
interface TransmitService {
  broadcast(channel: string, data: unknown): void
}

export default class LogStreamProvider {
  private service: LogStreamService | null = null

  constructor(protected app: ApplicationService) {}

  async ready() {
    if (this.app.inTest) return

    let transmit: TransmitService
    try {
      transmit = (await this.app.container.make('transmit')) as TransmitService
    } catch {
      log.info('@adonisjs/transmit not available — live log streaming disabled')
      return
    }

    const channelName = this.app.config.get<string>('server_stats.logChannelName', 'admin/logs')

    const broadcast = (entry: Record<string, unknown>) => {
      try {
        transmit.broadcast(channelName, JSON.parse(JSON.stringify(entry)))
      } catch {
        // Silently ignore broadcast errors
      }
    }

    // If logCollector() is already hooked into Pino (zero-config),
    // piggyback on its stream instead of creating a file poller.
    const existing = getLogStreamService()
    if (existing) {
      const internal = existing as unknown as { onEntry?: (entry: Record<string, unknown>) => void }
      const origOnEntry = internal.onEntry
      internal.onEntry = (entry: Record<string, unknown>) => {
        origOnEntry?.(entry)
        broadcast(entry)
      }
      return
    }

    // Fallback: poll the log file directly
    const logPath = this.app.makePath('logs', 'adonisjs.log')
    this.service = new LogStreamService(logPath, broadcast)
    await this.service.start()
  }

  async shutdown() {
    this.service?.stop()
  }
}
