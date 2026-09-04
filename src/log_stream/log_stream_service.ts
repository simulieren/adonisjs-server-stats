import { open, stat } from 'node:fs/promises'

import { log } from '../utils/logger.js'

import type { LogStats } from '../types.js'

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
  private static readonly MAX_RECENT_ENTRIES = 10_000
  private static readonly MAX_POLL_BYTES = 4 * 1024 * 1024
  private lastSize = 0
  private intervalId: ReturnType<typeof setInterval> | null = null
  private logPath: string | null
  private onEntry?: (entry: Record<string, unknown>) => void
  private warnedPollFailure = false

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
    this.pushRecent(Date.now(), level)
    this.onEntry?.(entry)
  }

  /** Record a timestamp, capping the array to prevent unbounded growth under high log volume. */
  private pushRecent(time: number, level: number) {
    if (this.recentEntries.length >= LogStreamService.MAX_RECENT_ENTRIES) {
      this.recentEntries.splice(0, Math.floor(LogStreamService.MAX_RECENT_ENTRIES / 4))
    }
    this.recentEntries.push({ time, level })
  }

  getLogStats(): LogStats {
    const now = Date.now()
    const cutoff = now - ROLLING_WINDOW_MS

    // Prune old entries using splice (O(1) amortized) instead of
    // repeated shift() which is O(N) per call
    let pruneEnd = 0
    while (pruneEnd < this.recentEntries.length && this.recentEntries[pruneEnd].time < cutoff) {
      pruneEnd++
    }
    if (pruneEnd > 0) {
      this.recentEntries.splice(0, pruneEnd)
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

  /** Reset the once-per-streak failure flag after a fully successful poll. */
  private markPollHealthy() {
    if (this.warnedPollFailure) {
      this.warnedPollFailure = false
      log.info('log stream: log file is readable again — resuming')
    }
  }

  private async pollNewEntries() {
    if (!this.logPath) return
    try {
      const stats = await stat(this.logPath)

      // File was truncated/rotated — reset
      if (stats.size < this.lastSize) {
        this.lastSize = 0
      }

      if (stats.size <= this.lastSize) {
        this.markPollHealthy()
        return
      }

      // Cap each read so a rotation reset or burst can never allocate the
      // whole backlog in one buffer; skip ahead and read only the tail.
      // A partial first line after skipping fails JSON.parse and is dropped.
      const readFrom = Math.max(this.lastSize, stats.size - LogStreamService.MAX_POLL_BYTES)
      const newBytes = stats.size - readFrom
      const buffer = Buffer.alloc(newBytes)
      const fd = await open(this.logPath, 'r')
      await fd.read(buffer, 0, newBytes, readFrom).finally(() => fd.close())
      this.lastSize = stats.size
      this.markPollHealthy()

      for (const line of buffer.toString('utf-8').trim().split('\n')) {
        const entry = parseAndEnrich(line)
        if (entry) {
          const level = typeof entry.level === 'number' ? entry.level : 30
          const time = typeof entry.time === 'number' ? entry.time : Date.now()
          this.pushRecent(time, level)
          this.onEntry?.(entry)
        }
      }
    } catch (err) {
      if (this.warnedPollFailure) return
      this.warnedPollFailure = true
      // A missing file is a normal state for the fallback poller — the file
      // appears once the app writes its first log line. Anything else
      // (permissions, a directory in the way) deserves a real warning.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        log.info('log stream: log file not found (will keep watching) — ' + this.logPath)
      } else {
        log.warn('log stream: cannot read log file — ' + (err as Error)?.message)
      }
    }
  }
}
