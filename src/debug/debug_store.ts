import { writeFile, readFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { log, bold } from '../utils/logger.js'
import { EmailCollector } from './email_collector.js'
import { EventCollector } from './event_collector.js'
import { QueryCollector } from './query_collector.js'
import { RouteInspector } from './route_inspector.js'
import { TraceCollector } from './trace_collector.js'

import type { DevToolbarConfig, Emitter, Router } from './types.js'


/** Read and parse persisted debug data from disk. Returns null on failure. */
async function readPersistedData(filePath: string): Promise<Record<string, unknown> | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn(
        `Failed to read persisted debug data from ${bold(filePath)}: ${(error as Error)?.message}`
      )
    }
    return null
  }

  try {
    const data = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return null
    return data as Record<string, unknown>
  } catch {
    log.warn(`Persisted debug data corrupted, resetting: ${bold(filePath)}`)
    return null
  }
}

/** Load an array from the record into a collector if present and non-empty. */
function loadIfPresent<T>(
  record: Record<string, unknown>,
  key: string,
  loader: { loadRecords(records: T[]): void } | null
): void {
  if (!loader) return
  if (Array.isArray(record[key]) && record[key].length > 0) {
    loader.loadRecords(record[key] as T[])
  }
}

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

  /** Return buffer utilization stats for all debug collectors. */
  getBufferStats(): {
    queries: { current: number; max: number }
    events: { current: number; max: number }
    emails: { current: number; max: number }
    traces: { current: number; max: number }
  } {
    return {
      queries: this.queries.getBufferInfo(),
      events: this.events.getBufferInfo(),
      emails: this.emails.getBufferInfo(),
      traces: this.traces?.getBufferInfo() ?? { current: 0, max: 0 },
    }
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
    // Build JSON incrementally to avoid a single massive JSON.stringify
    // that blocks the event loop when buffers are large.
    const parts: string[] = ['{']

    const queries = this.queries.getQueries()
    parts.push(`"queries":${JSON.stringify(queries)},`)

    // Yield between each collector's serialization to let the event loop breathe
    await new Promise<void>((resolve) => setImmediate(resolve))

    const events = this.events.getEvents()
    parts.push(`"events":${JSON.stringify(events)},`)

    await new Promise<void>((resolve) => setImmediate(resolve))

    const emails = this.emails.getEmails()
    parts.push(`"emails":${JSON.stringify(emails)}`)

    if (this.traces) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      const traces = this.traces.getTraces()
      parts.push(`,"traces":${JSON.stringify(traces)}`)
    }

    parts.push('}')
    const json = parts.join('')

    const tmpPath = filePath + '.tmp'
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tmpPath, json, 'utf-8')
    await rename(tmpPath, filePath)
  }

  /** Restore collector data from a JSON file on disk. */
  async loadFromDisk(filePath: string): Promise<void> {
    const record = await readPersistedData(filePath)
    if (!record) return

    loadIfPresent(record, 'queries', this.queries)
    loadIfPresent(record, 'events', this.events)
    loadIfPresent(record, 'emails', this.emails)
    loadIfPresent(record, 'traces', this.traces)
  }
}
