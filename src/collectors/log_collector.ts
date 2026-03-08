import { existsSync } from 'node:fs'

import { LogStreamService } from '../log_stream/log_stream_service.js'
import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

export interface LogCollectorOptions {
  logPath: string
}

let sharedLogStream: LogStreamService | null = null

export function getLogStreamService(): LogStreamService | null {
  return sharedLogStream
}

function warnMissingFile(logPath: string, alreadyWarned: boolean): boolean {
  if (alreadyWarned) return true
  log.warn(`Log file not found: ${bold(logPath)}`)
  log.block(
    'The log collector will keep retrying, but no metrics will appear until the file exists.',
    [
      dim('Make sure the path is correct and your app is writing logs there.'),
      dim('The file must contain newline-delimited JSON with') +
        ` ${bold('level')} ` +
        dim('and') +
        ` ${bold('time')} ` +
        dim('fields (Pino format).'),
    ]
  )
  return true
}

function warnStartFailure(error: unknown, logPath: string, alreadyWarned: boolean): boolean {
  if (alreadyWarned) return true
  log.warn(`Log collector failed to start: ${bold(String(error))}`)
  log.block('The log collector will not produce metrics until this is resolved.', [
    dim('Configured log path:') + ` ${bold(logPath)}`,
    dim('Check file permissions and ensure the directory exists.'),
  ])
  return true
}

export function logCollector(opts?: LogCollectorOptions): MetricCollector {
  if (sharedLogStream) {
    console.warn(
      '[server-stats] logCollector() called again — stopping previous LogStreamService instance'
    )
    sharedLogStream.stop()
  }

  const service = new LogStreamService(opts?.logPath)
  sharedLogStream = service

  let warnedMissing = false
  let warnedStart = false

  return {
    name: 'log',
    label: opts?.logPath ? `log — file: ${opts.logPath}` : 'log — pino stream (zero-config)',

    getConfig() {
      return {
        logPath: opts?.logPath ?? null,
        mode: opts?.logPath ? 'file' : 'stream',
      }
    },

    async start() {
      if (!opts?.logPath) return

      if (!existsSync(opts.logPath)) {
        warnedMissing = warnMissingFile(opts.logPath, warnedMissing)
      }

      try {
        await service.start()
      } catch (error) {
        warnedStart = warnStartFailure(error, opts.logPath, warnedStart)
      }
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
