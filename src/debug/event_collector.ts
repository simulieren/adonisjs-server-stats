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

  /** Reusable WeakSet to avoid GC churn on every event. */
  private circulars = new WeakSet<WeakKey>()

  private summarizeData(data: unknown): string | null {
    if (data === undefined || data === null) return null

    try {
      if (typeof data === 'string') return data.length > 4096 ? data.slice(0, 4096) + '...' : data
      if (typeof data !== 'object') return String(data)

      // Reuse the WeakSet across calls to avoid per-event allocation
      this.circulars = new WeakSet()
      const limited = this.limitDepth(data, 3, this.circulars)
      // Compact JSON (no indent) to reduce string size and serialization time
      const result = JSON.stringify(limited) ?? ''
      return result.length > 4096 ? result.slice(0, 4096) + '...' : result
    } catch {
      if (typeof data === 'object' && data !== null) {
        const ctorName = (data as { constructor?: { name?: string } }).constructor?.name
        if (ctorName) return `[${ctorName}]`
      }
      return typeof data
    }
  }

  /**
   * Recursively limit object depth to prevent deeply-nested payloads
   * from causing expensive serialization.
   */
  private limitDepth(value: unknown, maxDepth: number, seen: WeakSet<WeakKey>): unknown {
    if (maxDepth <= 0) return '[...]'
    if (value === null || value === undefined) return value
    if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`
    if (typeof value === 'bigint') return value.toString()
    if (typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (Array.isArray(value)) {
      const take = Math.min(value.length, 20)
      const arr = new Array(take)
      for (let i = 0; i < take; i++) {
        arr[i] = this.limitDepth(value[i], maxDepth - 1, seen)
      }
      return arr
    }

    const keys = Object.keys(value as Record<string, unknown>)
    const result: Record<string, unknown> = {}
    const limit = Math.min(keys.length, 50)
    for (let i = 0; i < limit; i++) {
      result[keys[i]] = this.limitDepth(
        (value as Record<string, unknown>)[keys[i]],
        maxDepth - 1,
        seen
      )
    }
    if (keys.length > 50) {
      result['...'] = `(${keys.length - 50} more keys)`
    }
    return result
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

  getBufferInfo(): { current: number; max: number } {
    return { current: this.buffer.size(), max: this.buffer.getCapacity() }
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
