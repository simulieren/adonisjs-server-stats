import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'

import { round } from '../utils/math_helpers.js'
import { RingBuffer } from './ring_buffer.js'

import type { TraceSpan, TraceRecord } from './types.js'

/**
 * Per-request trace context stored in AsyncLocalStorage.
 * Tracks spans, warnings, and nesting for one HTTP request.
 */
interface TraceContext {
  requestStart: number
  spans: TraceSpan[]
  warnings: string[]
  nextSpanId: number
  currentSpanId: string | null
}

/**
 * Module-level singleton reference for the `trace()` helper.
 */
let globalTraceCollector: TraceCollector | null = null

/**
 * Wrap an async function in a traced span.
 *
 * If tracing is not enabled or no request is active, the function
 * is executed directly without overhead.
 *
 * @example
 * ```ts
 * import { trace } from 'adonisjs-server-stats'
 *
 * const result = await trace('fetchMembers', async () => {
 *   return OrganizationService.getMembers(orgId)
 * })
 * ```
 */
export async function trace<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!globalTraceCollector) return fn()
  return globalTraceCollector.span(label, 'custom', fn)
}

/**
 * Collects per-request traces using AsyncLocalStorage.
 *
 * Automatically captures DB queries and console.warn calls within
 * the request context. Users can add custom spans via {@link trace}.
 */
export class TraceCollector {
  private buffer: RingBuffer<TraceRecord>
  private als = new AsyncLocalStorage<TraceContext>()
  private emitter: any = null
  private dbHandler: ((data: any) => void) | null = null
  private originalConsoleWarn: typeof console.warn | null = null

  constructor(maxTraces: number = 200) {
    this.buffer = new RingBuffer<TraceRecord>(maxTraces)
    globalTraceCollector = this
  }

  /** Start a new trace context for an HTTP request. */
  startTrace(callback: () => Promise<void>): Promise<void> {
    const ctx: TraceContext = {
      requestStart: performance.now(),
      spans: [],
      warnings: [],
      nextSpanId: 1,
      currentSpanId: null,
    }
    return this.als.run(ctx, callback)
  }

  /** Finish the current trace and save it to the ring buffer. Returns the record, or null if no context. */
  finishTrace(method: string, url: string, statusCode: number): TraceRecord | null {
    const ctx = this.als.getStore()
    if (!ctx) return null

    const totalDuration = performance.now() - ctx.requestStart

    const record: TraceRecord = {
      id: this.buffer.getNextId(),
      method,
      url,
      statusCode,
      totalDuration: round(totalDuration),
      spanCount: ctx.spans.length,
      spans: ctx.spans,
      warnings: ctx.warnings,
      timestamp: Date.now(),
    }

    this.buffer.push(record)
    return record
  }

  /** Add a span to the current trace (if active). */
  addSpan(
    label: string,
    category: TraceSpan['category'],
    startOffset: number,
    duration: number,
    metadata?: Record<string, any>
  ): void {
    const ctx = this.als.getStore()
    if (!ctx) return

    ctx.spans.push({
      id: String(ctx.nextSpanId++),
      parentId: ctx.currentSpanId,
      label,
      category,
      startOffset: round(startOffset),
      duration: round(duration),
      metadata,
    })
  }

  /** Wrap a function in a traced span with automatic nesting. */
  async span<T>(label: string, category: TraceSpan['category'], fn: () => Promise<T>): Promise<T> {
    const ctx = this.als.getStore()
    if (!ctx) return fn()

    const start = performance.now()
    const parentId = ctx.currentSpanId
    const spanId = String(ctx.nextSpanId++)
    ctx.currentSpanId = spanId

    try {
      return await fn()
    } finally {
      const duration = performance.now() - start
      ctx.spans.push({
        id: spanId,
        parentId,
        label,
        category,
        startOffset: round(start - ctx.requestStart),
        duration: round(duration),
      })
      ctx.currentSpanId = parentId
    }
  }

  /** Hook into db:query events and console.warn to auto-create spans. */
  start(emitter: any): void {
    this.emitter = emitter

    if (emitter && typeof emitter.on === 'function') {
      this.dbHandler = (data: any) => {
        const ctx = this.als.getStore()
        if (!ctx) return

        const duration =
          typeof data.duration === 'number'
            ? data.duration
            : Array.isArray(data.duration)
              ? data.duration[0] * 1e3 + data.duration[1] / 1e6
              : 0

        const offset = performance.now() - ctx.requestStart - duration

        this.addSpan(data.sql || 'query', 'db', offset, duration, {
          method: data.method,
          model: data.model,
          connection: data.connection,
        })
      }
      emitter.on('db:query', this.dbHandler)
    }

    // Intercept console.warn to capture warnings per-request
    this.originalConsoleWarn = console.warn
    const self = this
    console.warn = function (...args: any[]) {
      const ctx = self.als.getStore()
      if (ctx) {
        ctx.warnings.push(args.map(String).join(' '))
      }
      self.originalConsoleWarn!.apply(console, args)
    }
  }

  /** Unhook event listeners and restore console.warn. */
  stop(): void {
    if (this.emitter && this.dbHandler) {
      this.emitter.off('db:query', this.dbHandler)
    }
    if (this.originalConsoleWarn) {
      console.warn = this.originalConsoleWarn
    }
    this.dbHandler = null
    this.emitter = null
    this.originalConsoleWarn = null
    globalTraceCollector = null
  }

  getTraces(): TraceRecord[] {
    return this.buffer.toArray()
  }

  getLatest(n: number): TraceRecord[] {
    return this.buffer.latest(n)
  }

  getTrace(id: number): TraceRecord | undefined {
    return this.buffer.toArray().find((t) => t.id === id)
  }

  getTotalCount(): number {
    return this.buffer.size()
  }

  clear(): void {
    this.buffer.clear()
  }

  /** Register a callback that fires whenever a new trace is recorded. */
  onNewItem(cb: ((item: TraceRecord) => void) | null): void {
    this.buffer.onPush(cb)
  }

  /** Restore persisted records into the buffer and reset the ID counter. */
  loadRecords(records: TraceRecord[]): void {
    this.buffer.load(records)
    const maxId = records.reduce((m, r) => Math.max(m, r.id), 0)
    this.buffer.setNextId(maxId + 1)
  }
}
