import { open, stat } from 'node:fs/promises'

import { log } from '../utils/logger.js'

import type { LogStats } from '../types.js'

let warnedPollFailure = false

const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

const ROLLING_WINDOW_MS = 5 * 60 * 1000

interface LogTimestamp {
  time: number
  level: number
}

export function parseAndEnrich(line: string): Record<string, unknown> | null {
  if (!line) return null
  try {
    const entry = JSON.parse(line)
    return {
      ...entry,
      levelName: LEVEL_NAMES[entry.level] || 'unknown',
      timestamp: new Date(entry.time).toISOString(),
    }
  } catch {
    return null
  }
}

export class LogStreamService {
  private recentEntries: LogTimestamp[] = []
  private lastSize = 0
  private intervalId: ReturnType<typeof setInterval> | null = null
  private logPath: string | null
  private onEntry?: (entry: Record<string, unknown>) => void

  constructor(logPath?: string, onEntry?: (entry: Record<string, unknown>) => void) {
    this.logPath = logPath ?? null
    this.onEntry = onEntry
  }

  /**
   * Ingest a parsed log entry directly (no file needed).
   *
   * Used by the Pino stream interceptor to feed entries
   * in real-time without file polling.
   */
  ingest(entry: Record<string, unknown>) {
    const level = typeof entry.level === 'number' ? entry.level : 30
    this.recentEntries.push({ time: Date.now(), level })
    this.onEntry?.(entry)
  }

  getLogStats(): LogStats {
    const now = Date.now()
    const cutoff = now - ROLLING_WINDOW_MS

    // Prune old entries
    while (this.recentEntries.length > 0 && this.recentEntries[0].time < cutoff) {
      this.recentEntries.shift()
    }

    let errors = 0
    let warnings = 0
    for (const entry of this.recentEntries) {
      if (entry.level >= 50) errors++
      else if (entry.level >= 40) warnings++
    }

    const total = this.recentEntries.length
    const minutes = ROLLING_WINDOW_MS / 60_000

    return {
      errorsLast5m: errors,
      warningsLast5m: warnings,
      entriesLast5m: total,
      entriesPerMinute: total > 0 ? Math.round((total / minutes) * 10) / 10 : 0,
    }
  }

  async start() {
    if (!this.logPath) {
      // Stream-only mode — entries arrive via ingest(), no file polling
      return
    }

    // Initialize with current file size so we only process new entries
    try {
      const stats = await stat(this.logPath)
      this.lastSize = stats.size
    } catch {
      // File doesn't exist yet
    }

    this.intervalId = setInterval(() => this.pollNewEntries(), 2000)
    log.info('log stream watching: ' + this.logPath)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private async pollNewEntries() {
    if (!this.logPath) return
    try {
      warnedPollFailure = false
      const stats = await stat(this.logPath)

      // File was truncated/rotated — reset
      if (stats.size < this.lastSize) {
        this.lastSize = 0
      }

      if (stats.size <= this.lastSize) return

      const newBytes = stats.size - this.lastSize
      const buffer = Buffer.alloc(newBytes)
      const fd = await open(this.logPath, 'r')
      await fd.read(buffer, 0, newBytes, this.lastSize).finally(() => fd.close())
      this.lastSize = stats.size

      for (const line of buffer.toString('utf-8').trim().split('\n')) {
        const entry = parseAndEnrich(line)
        if (entry) {
          this.recentEntries.push({ time: Date.now(), level: entry.level as number })
          this.onEntry?.(entry)
        }
      }
    } catch (err) {
      if (!warnedPollFailure) {
        warnedPollFailure = true
        log.warn('log stream: cannot read log file — ' + (err as Error)?.message)
      }
    }
  }
}
