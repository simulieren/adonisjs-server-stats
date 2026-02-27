import { writeFile, readFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { log, bold } from '../utils/logger.js'
import { EmailCollector } from './email_collector.js'
import { EventCollector } from './event_collector.js'
import { QueryCollector } from './query_collector.js'
import { RouteInspector } from './route_inspector.js'
import { TraceCollector } from './trace_collector.js'

import type { DevToolbarConfig, Emitter, Router } from './types.js'

/**
 * Singleton store holding all debug data collectors.
 * Bound to the AdonisJS container as `debug.store`.
 */
export class DebugStore {
  readonly queries: QueryCollector
  readonly events: EventCollector
  readonly emails: EmailCollector
  readonly routes: RouteInspector
  readonly traces: TraceCollector | null

  constructor(config: DevToolbarConfig) {
    this.queries = new QueryCollector(config.maxQueries, config.slowQueryThresholdMs)
    this.events = new EventCollector(config.maxEvents)
    this.emails = new EmailCollector(config.maxEmails)
    this.routes = new RouteInspector()
    this.traces = config.tracing ? new TraceCollector(config.maxTraces) : null
  }

  /**
   * Register a callback that fires whenever any collector records a new item.
   * The callback receives the item type ('query' | 'event' | 'email' | 'trace').
   */
  onNewItem(cb: ((type: string) => void) | null): void {
    this.queries.onNewItem(cb ? () => cb('query') : null)
    this.events.onNewItem(cb ? () => cb('event') : null)
    this.emails.onNewItem(cb ? () => cb('email') : null)
    this.traces?.onNewItem(cb ? () => cb('trace') : null)
  }

  async start(emitter: unknown, router: unknown): Promise<void> {
    // Runtime-check the emitter before passing to collectors.
    // The container returns `unknown`; collectors guard internally too.
    const e = emitter as Emitter
    await this.queries.start(e)
    this.events.start(e)
    await this.emails.start(e)
    if (router && typeof (router as Router).toJSON === 'function') {
      this.routes.inspect(router as Router)
    }
    this.traces?.start(e)
  }

  stop(): void {
    this.queries.stop()
    this.events.stop()
    this.emails.stop()
    this.traces?.stop()
  }

  /** Serialize all collector data to a JSON file (atomic write). */
  async saveToDisk(filePath: string): Promise<void> {
    const data: Record<string, unknown> = {
      queries: this.queries.getQueries(),
      events: this.events.getEvents(),
      emails: this.emails.getEmails(),
    }
    if (this.traces) {
      data.traces = this.traces.getTraces()
    }
    const json = JSON.stringify(data)
    const tmpPath = filePath + '.tmp'
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tmpPath, json, 'utf-8')
    await rename(tmpPath, filePath)
  }

  /** Restore collector data from a JSON file on disk. */
  async loadFromDisk(filePath: string): Promise<void> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        log.warn(`Failed to read persisted debug data from ${bold(filePath)}: ${(error as Error)?.message}`)
      }
      return
    }

    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      log.warn(`Persisted debug data corrupted, resetting: ${bold(filePath)}`)
      return
    }

    if (typeof data !== 'object' || data === null) return
    const record = data as Record<string, unknown>

    if (Array.isArray(record.queries) && record.queries.length > 0) {
      this.queries.loadRecords(record.queries)
    }
    if (Array.isArray(record.events) && record.events.length > 0) {
      this.events.loadRecords(record.events)
    }
    if (Array.isArray(record.emails) && record.emails.length > 0) {
      this.emails.loadRecords(record.emails)
    }
    if (this.traces && Array.isArray(record.traces) && record.traces.length > 0) {
      this.traces.loadRecords(record.traces)
    }
  }
}
