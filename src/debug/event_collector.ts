import { isExcludedRequest } from '../middleware/request_tracking_middleware.js'
import { RingBuffer } from './ring_buffer.js'

import type { EventRecord, Emitter } from './types.js'

/** Events to skip (handled by other collectors or noisy). */
const SKIPPED_EVENTS = new Set([
  'db:query',
  'mail:sending',
  'mail:sent',
  'mail:queueing',
  'mail:queued',
  'queued:mail:error',
  'http:request_completed',
])

/** Check if an event should be recorded. */
function shouldRecord(eventName: string): boolean {
  if (eventName.startsWith('__')) return false
  if (SKIPPED_EVENTS.has(eventName)) return false
  if (isExcludedRequest()) return false
  return true
}

/** Truncate a string to a max length. */
function truncateString(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s
}

/** Fallback stringification when JSON.stringify fails. */
function fallbackStringify(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const ctorName = (data as { constructor?: { name?: string } }).constructor?.name
    if (ctorName) return `[${ctorName}]`
  }
  return typeof data
}

/** Limit depth of an array value. */
function limitDepthArray(value: unknown[], maxDepth: number, seen: WeakSet<WeakKey>): unknown[] {
  const take = Math.min(value.length, 20)
  const arr: unknown[] = Array.from({ length: take })
  for (let i = 0; i < take; i++) {
    arr[i] = limitDepth(value[i], maxDepth - 1, seen)
  }
  return arr
}

/** Limit depth of an object value. */
function limitDepthObject(
  value: Record<string, unknown>,
  maxDepth: number,
  seen: WeakSet<WeakKey>
): Record<string, unknown> {
  const keys = Object.keys(value)
  const result: Record<string, unknown> = {}
  const limit = Math.min(keys.length, 50)
  for (let i = 0; i < limit; i++) {
    result[keys[i]] = limitDepth(value[keys[i]], maxDepth - 1, seen)
  }
  if (keys.length > 50) {
    result['...'] = `(${keys.length - 50} more keys)`
  }
  return result
}

/** Recursively limit object depth to prevent expensive serialization. */
function limitDepth(value: unknown, maxDepth: number, seen: WeakSet<WeakKey>): unknown {
  if (maxDepth <= 0) return '[...]'
  if (value === null || value === undefined) return value
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) return limitDepthArray(value, maxDepth, seen)
  return limitDepthObject(value as Record<string, unknown>, maxDepth, seen)
}

/**
 * Wraps the AdonisJS emitter to log all events with timestamps.
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
      const eventName = typeof event === 'string' ? event : event?.name || 'unknown'

      if (shouldRecord(eventName)) {
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

  private circulars = new WeakSet<WeakKey>()

  private summarizeData(data: unknown): string | null {
    if (data === undefined || data === null) return null

    try {
      if (typeof data === 'string') return truncateString(data, 4096)
      if (typeof data !== 'object') return String(data)

      this.circulars = new WeakSet()
      const limited = limitDepth(data, 3, this.circulars)
      const result = JSON.stringify(limited) ?? ''
      return truncateString(result, 4096)
    } catch {
      return fallbackStringify(data)
    }
  }

  getEvents(): EventRecord[] {
    return this.buffer.toArray().reverse()
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

  onNewItem(cb: ((item: EventRecord) => void) | null): void {
    this.buffer.onPush(cb)
  }

  loadRecords(records: EventRecord[]): void {
    this.buffer.load(records)
    const maxId = records.reduce((m, r) => Math.max(m, r.id), 0)
    this.buffer.setNextId(maxId + 1)
  }
}
