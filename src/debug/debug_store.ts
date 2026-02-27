import { writeFile, readFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { log, bold } from '../utils/logger.js'
import { EmailCollector } from './email_collector.js'
import { EventCollector } from './event_collector.js'
import { QueryCollector } from './query_collector.js'
import { RouteInspector } from './route_inspector.js'
import { TraceCollector } from './trace_collector.js'

import type { DevToolbarConfig } from './types.js'

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

  async start(emitter: any, router: any): Promise<void> {
    await this.queries.start(emitter)
    this.events.start(emitter)
    await this.emails.start(emitter)
    this.routes.inspect(router)
    this.traces?.start(emitter)
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

    let data: any
    try {
      data = JSON.parse(raw)
    } catch {
      log.warn(`Persisted debug data corrupted, resetting: ${bold(filePath)}`)
      return
    }

    if (Array.isArray(data.queries) && data.queries.length > 0) {
      this.queries.loadRecords(data.queries)
    }
    if (Array.isArray(data.events) && data.events.length > 0) {
      this.events.loadRecords(data.events)
    }
    if (Array.isArray(data.emails) && data.emails.length > 0) {
      this.emails.loadRecords(data.emails)
    }
    if (this.traces && Array.isArray(data.traces) && data.traces.length > 0) {
      this.traces.loadRecords(data.traces)
    }
  }
}
