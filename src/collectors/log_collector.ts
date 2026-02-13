import { LogStreamService } from '../log_stream/log_stream_service.js'

import type { MetricCollector } from './collector.js'

export interface LogCollectorOptions {
  logPath: string
}

let sharedLogStream: LogStreamService | null = null

export function getLogStreamService(): LogStreamService | null {
  return sharedLogStream
}

export function logCollector(opts: LogCollectorOptions): MetricCollector {
  const service = new LogStreamService(opts.logPath)
  sharedLogStream = service

  return {
    name: 'log',

    async start() {
      await service.start()
    },

    stop() {
      service.stop()
    },

    collect() {
      const stats = service.getLogStats()
      return {
        logErrorsLast5m: stats.errorsLast5m,
        logWarningsLast5m: stats.warningsLast5m,
        logEntriesLast5m: stats.entriesLast5m,
        logEntriesPerMinute: stats.entriesPerMinute,
      }
    },
  }
}
