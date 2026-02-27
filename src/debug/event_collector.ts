import { isExcludedRequest } from '../middleware/request_tracking_middleware.js'
import { RingBuffer } from './ring_buffer.js'

import type { EventRecord, Emitter } from './types.js'

/**
 * Wraps the AdonisJS emitter to log all events with timestamps.
 * Uses monkey-patching of emitter.emit to intercept all events.
 */
export class EventCollector {
  private buffer: RingBuffer<EventRecord>
  private originalEmit: Emitter['emit'] | null = null
  private emitter: Emitter | null = null

  constructor(maxEvents: number = 200) {
    this.buffer = new RingBuffer<EventRecord>(maxEvents)
  }

  start(emitter: Emitter): void {
    if (!emitter || typeof emitter.emit !== 'function') return

    this.emitter = emitter
    this.originalEmit = emitter.emit.bind(emitter) as Emitter['emit']

    emitter.emit = (event: string | ((...args: unknown[]) => unknown), data?: unknown) => {
      // Resolve event name: class-based events use the class name, string events are used as-is
      const eventName = typeof event === 'string' ? event : event?.name || 'unknown'

      // Skip internal/noisy events, mail events (handled by EmailCollector),
      // HTTP lifecycle events (redundant with timeline), and events triggered
      // by debug panel polling requests
      if (
        !eventName.startsWith('__') &&
        eventName !== 'db:query' &&
        !eventName.startsWith('mail:') &&
        eventName !== 'queued:mail:error' &&
        eventName !== 'http:request_completed' &&
        !isExcludedRequest()
      ) {
        const record: EventRecord = {
          id: this.buffer.getNextId(),
          event: eventName,
          data: this.summarizeData(data),
          timestamp: Date.now(),
        }
        this.buffer.push(record)
      }

      return this.originalEmit!.call(emitter, event, data)
    }
  }

  stop(): void {
    if (this.emitter && this.originalEmit) {
      this.emitter.emit = this.originalEmit
    }
    this.originalEmit = null
    this.emitter = null
  }

  private summarizeData(data: unknown): string | null {
    if (data === undefined || data === null) return null

    try {
      if (typeof data === 'string') return data
      const json = JSON.stringify(data, this.safeReplacer(), 2)
      // Cap at 4KB per event to avoid memory bloat
      return json.length > 4096 ? json.slice(0, 4096) + '\n...' : json
    } catch {
      if (typeof data === 'object' && data !== null) {
        const ctorName = (data as { constructor?: { name?: string } }).constructor?.name
        if (ctorName) return `[${ctorName}]`
      }
      return typeof data
    }
  }

  private safeReplacer() {
    const seen = new WeakSet()
    return (_key: string, value: unknown) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`
      if (typeof value === 'bigint') return value.toString()
      return value
    }
  }

  getEvents(): EventRecord[] {
    return this.buffer.toArray()
  }

  getLatest(n: number = 100): EventRecord[] {
    return this.buffer.latest(n)
  }

  getTotalCount(): number {
    return this.buffer.size()
  }

  clear(): void {
    this.buffer.clear()
  }

  /** Register a callback that fires whenever a new event is recorded. */
  onNewItem(cb: ((item: EventRecord) => void) | null): void {
    this.buffer.onPush(cb)
  }

  /** Restore persisted records into the buffer and reset the ID counter. */
  loadRecords(records: EventRecord[]): void {
    this.buffer.load(records)
    const maxId = records.reduce((m, r) => Math.max(m, r.id), 0)
    this.buffer.setNextId(maxId + 1)
  }
}
