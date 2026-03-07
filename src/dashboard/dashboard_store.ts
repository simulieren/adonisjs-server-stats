import { mkdir, stat as fsStat } from 'node:fs/promises'
import { dirname } from 'node:path'

import { safeParseJson, safeParseJsonArray } from '../utils/json_helpers.js'
import { log } from '../utils/logger.js'
import { extractAddresses } from '../utils/mail_helpers.js'
import { round } from '../utils/math_helpers.js'
import { rangeToCutoff, rangeToMinutes, roundBucket } from '../utils/time_helpers.js'
import { ChartAggregator } from './chart_aggregator.js'
import { autoMigrate, runRetentionCleanup } from './migrator.js'

import type { DevToolbarConfig } from '../debug/types.js'
import type { QueryRecord, EventRecord, EmailRecord, TraceRecord } from '../debug/types.js'
import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// Minimal interface for an AdonisJS-style event emitter
// ---------------------------------------------------------------------------

interface EventEmitter {
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export interface RequestInput {
  method: string
  url: string
  statusCode: number
  duration: number
  spanCount?: number
  warningCount?: number
}

export interface PersistRequestInput extends RequestInput {
  queries: QueryRecord[]
  trace: TraceRecord | null
}

export interface RequestFilters {
  method?: string
  url?: string
  status?: number
  statusMin?: number
  statusMax?: number
  durationMin?: number
  durationMax?: number
  /** General text search across method and url */
  search?: string
}

export interface QueryFilters {
  method?: string
  model?: string
  connection?: string
  durationMin?: number
  durationMax?: number
  requestId?: number
  /** General text search across sql_text, model, and connection */
  search?: string
}

export interface EventFilters {
  eventName?: string
  /** General text search across event_name */
  search?: string
}

export interface EmailFilters {
  /** General text search across from_addr, to_addr, and subject */
  search?: string
  from?: string
  to?: string
  subject?: string
  mailer?: string
  status?: string
}

export interface LogFilters {
  level?: string
  requestId?: string
  search?: string
  /** Structured filters: array of { field, operator, value } */
  structured?: { field: string; operator: 'equals' | 'contains' | 'startsWith'; value: string }[]
}

export interface TraceFilters {
  method?: string
  url?: string
  statusMin?: number
  statusMax?: number
  /** General text search across method and url */
  search?: string
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  perPage: number
  lastPage: number
}

// ---------------------------------------------------------------------------
// Warn-once tracking for write-path and overview catch blocks
// ---------------------------------------------------------------------------
const warnedWritePaths = new Set<string>()
let overviewWidgetWarned = false

// ---------------------------------------------------------------------------
// DashboardStore
// ---------------------------------------------------------------------------

/**
 * Bridges the in-memory RingBuffer collectors to SQLite persistence
 * and provides query methods for the dashboard API.
 *
 * Handles auto-migration, retention cleanup, periodic metrics aggregation,
 * and self-exclusion of dashboard routes and server_stats connection queries.
 */
export class DashboardStore {
  private db: Knex | null = null
  private emitter: EventEmitter | null = null
  private config: DevToolbarConfig
  private dashboardPath: string
  private retentionTimer: ReturnType<typeof setInterval> | null = null
  private chartAggregator: ChartAggregator | null = null
  private handlers: { event: string; fn: (...args: unknown[]) => void }[] = []
  private dbFilePath: string = ''
  private lastCleanupAt: number | null = null

  // In-flight request coalescing — prevents concurrent identical reads from
  // each acquiring the single-connection pool independently. When 30 rapid
  // clicks trigger 30 getOverviewMetrics('1h') calls, only ONE actually
  // executes; the other 29 get the same promise.
  private inflight = new Map<string, Promise<unknown>>()

  private coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>

    const promise = fn().finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  // Short-lived result cache — serves stale data for repeat requests within
  // the TTL window. Cache miss falls through to coalesce(), so concurrent
  // cache misses still only execute once.
  private resultCache = new Map<string, { data: unknown; expiresAt: number }>()

  private cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const entry = this.resultCache.get(key)
    if (entry && Date.now() < entry.expiresAt) return Promise.resolve(entry.data as T)

    return this.coalesce(key, async () => {
      const result = await fn()
      this.resultCache.set(key, { data: result, expiresAt: Date.now() + ttlMs })
      return result
    })
  }

  // Cached storage stats (polled every 3s by Internals tab — cache for 10s)
  private cachedStorageStats: { data: unknown; cachedAt: number } | null = null
  private static readonly STORAGE_STATS_TTL_MS = 10_000

  // TTL constants for the cached() helper
  private static readonly WIDGETS_CACHE_TTL_MS = 2_000
  private static readonly SPARKLINE_CACHE_TTL_MS = 5_000
  private static readonly CHART_CACHE_TTL_MS = 5_000
  private static readonly QUERIES_GROUPED_CACHE_TTL_MS = 3_000
  private static readonly PAGINATE_CACHE_TTL_MS = 1_000

  // Write queue — buffers pending writes and flushes them in batch
  // transactions to avoid overwhelming the single-connection pool.
  private writeQueue: PersistRequestInput[] = []
  private pendingEvents: { requestIndex: number; events: EventRecord[] }[] = []
  private pendingLogs: Record<string, unknown>[] = []
  private pendingEmails: EmailRecord[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing: boolean = false
  private static readonly FLUSH_INTERVAL_MS = 500
  private static readonly MAX_QUEUE_SIZE = 200

  constructor(config: DevToolbarConfig) {
    this.config = config
    this.dashboardPath = config.dashboardPath
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Initialize the SQLite connection, run migrations and retention
   * cleanup, start chart aggregation, and wire event listeners.
   */
  async start(_lucidDb: unknown, emitter: EventEmitter | null, appRoot: string): Promise<void> {
    this.emitter = emitter

    this.dbFilePath = appRoot + '/' + this.config.dbPath
    const dbFilePath = this.dbFilePath
    await mkdir(dirname(dbFilePath), { recursive: true })

    // Create a standalone Knex connection to SQLite — bypasses Lucid's
    // connection manager entirely so we never pollute the app's pool.
    //
    // Must use appImport — bare import('knex') resolves to this package's
    // devDep copy when symlinked (file: dependency), which may have
    // different native bindings or conflict with the app's copies.
    log.info('dashboard: loading knex...')
    const { appImportWithPath } = await import('../utils/app_import.js')
    let knexModule: unknown
    let knexPath: string
    try {
      const result = await appImportWithPath('knex')
      knexModule = result.module
      knexPath = result.resolvedPath
    } catch (err) {
      throw new Error(
        `Could not load knex: ${(err as Error)?.message}. ` +
          'Install it with: npm install knex better-sqlite3'
      )
    }

    let sqlite3Path: string
    try {
      const result = await appImportWithPath('better-sqlite3')
      sqlite3Path = result.resolvedPath
    } catch (err) {
      throw new Error(
        `Could not load better-sqlite3: ${(err as Error)?.message}. ` +
          'Install it with: npm install better-sqlite3'
      )
    }

    log.info(`dashboard: knex resolved from ${knexPath}`)
    log.info(`dashboard: better-sqlite3 resolved from ${sqlite3Path}`)

    const knexFactory = (knexModule as Record<string, unknown>).default ?? knexModule
    log.info(`dashboard: opening SQLite database at ${dbFilePath}`)
    const db: Knex = (knexFactory as Function)({
      client: 'better-sqlite3',
      connection: { filename: dbFilePath },
      useNullAsDefault: true,
      // SQLite only supports one writer. Using a single-connection pool
      // prevents SQLITE_BUSY deadlocks under load and ensures PRAGMAs
      // are set consistently on the one connection that's reused.
      pool: {
        min: 1,
        max: 1,
        // Allow up to 10s for connection acquisition under load.
        // The previous 2s timeout caused cascading failures during rapid
        // tab switching when the write flush held the connection.
        acquireTimeoutMillis: 10_000,
        // Set PRAGMAs on every new connection (not just the first one)
        afterCreate(conn: unknown, done: (err: Error | null, conn: unknown) => void) {
          const raw = conn as { pragma: (stmt: string) => void }
          try {
            raw.pragma('journal_mode = WAL')
            raw.pragma('foreign_keys = ON')
            raw.pragma('synchronous = NORMAL')
            raw.pragma('cache_size = -64000') // 64 MB page cache
            raw.pragma('mmap_size = 268435456') // 256 MB memory-mapped I/O
            raw.pragma('temp_store = MEMORY')
            // Note: busy_timeout is a no-op via PRAGMA in better-sqlite3.
            // Use the `timeout` constructor option in better-sqlite3 if needed.
          } catch {
            // Fallback: PRAGMAs will be set via db.raw() below
          }
          done(null, conn)
        },
      },
    })
    this.db = db

    // Ensure PRAGMAs are set (fallback if afterCreate didn't work)
    log.info('dashboard: setting PRAGMA...')
    await db.raw('PRAGMA journal_mode=WAL')
    await db.raw('PRAGMA foreign_keys=ON')
    await db.raw('PRAGMA synchronous=NORMAL')
    await db.raw('PRAGMA cache_size=-64000')
    await db.raw('PRAGMA mmap_size=268435456')
    await db.raw('PRAGMA temp_store=MEMORY')
    log.info('dashboard: PRAGMA set')

    log.info('dashboard: running migrations...')
    await autoMigrate(db)
    log.info('dashboard: migrations complete')

    // Defer retention cleanup — not critical during startup.
    // Run first cleanup after 30s, then hourly.
    const runCleanup = async () => {
      try {
        if (this.db) {
          await runRetentionCleanup(this.db, this.config.retentionDays)
          this.lastCleanupAt = Date.now()
          log.info('dashboard: retention cleanup complete')
        }
      } catch (err) {
        log.warn('dashboard: retention cleanup failed — ' + (err as Error)?.message)
      }
    }
    setTimeout(() => runCleanup(), 30_000)
    this.retentionTimer = setInterval(() => runCleanup(), 60 * 60 * 1000)

    // Start chart aggregation (every 60s)
    this.chartAggregator = new ChartAggregator(db)
    this.chartAggregator.start()

    // Wire email event listeners
    this.wireEventListeners()

    log.info('dashboard: store initialized')
  }

  /** Shut down timers, event listeners, and database connection. */
  async stop(): Promise<void> {
    // Flush remaining writes before shutting down
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.flushWriteQueue().catch(() => {})

    if (this.retentionTimer) {
      clearInterval(this.retentionTimer)
      this.retentionTimer = null
    }

    this.chartAggregator?.stop()

    if (this.emitter) {
      for (const h of this.handlers) {
        if (typeof this.emitter.off === 'function') {
          this.emitter.off(h.event, h.fn)
        }
      }
    }
    this.handlers = []

    if (this.db && typeof this.db.destroy === 'function') {
      try {
        await this.db.destroy()
      } catch (err) {
        log.warn('dashboard: error closing SQLite — ' + (err as Error)?.message)
      }
    }
    this.db = null
  }

  /** Get the raw Knex database connection (for DashboardController). */
  getDb(): Knex | null {
    return this.db
  }

  /** Whether the store is initialized and ready. */
  isReady(): boolean {
    return this.db !== null
  }

  /**
   * Get SQLite storage statistics for the diagnostics endpoint.
   * Cached for 10s since the Internals tab polls every 3s.
   * Wrapped in a single transaction — 1 pool acquire instead of 8.
   */
  async getStorageStats(): Promise<{
    ready: boolean
    dbPath: string
    fileSizeMb: number
    walSizeMb: number
    retentionDays: number
    tables: Array<{ name: string; rowCount: number }>
    lastCleanupAt: number | null
  }> {
    if (!this.db) {
      return {
        ready: false,
        dbPath: this.config.dbPath,
        fileSizeMb: 0,
        walSizeMb: 0,
        retentionDays: this.config.retentionDays,
        tables: [],
        lastCleanupAt: null,
      }
    }

    // Serve cached stats if still fresh (avoids 8 COUNT queries per 3s poll)
    if (
      this.cachedStorageStats &&
      Date.now() - this.cachedStorageStats.cachedAt < DashboardStore.STORAGE_STATS_TTL_MS
    ) {
      return this.cachedStorageStats.data as Awaited<ReturnType<DashboardStore['getStorageStats']>>
    }

    return this.coalesce('storageStats', async () => {
      let fileSizeMb = 0
      let walSizeMb = 0
      try {
        const s = await fsStat(this.dbFilePath)
        fileSizeMb = Math.round((s.size / (1024 * 1024)) * 100) / 100
      } catch {
        // File may not exist yet
      }
      try {
        const ws = await fsStat(this.dbFilePath + '-wal')
        walSizeMb = Math.round((ws.size / (1024 * 1024)) * 100) / 100
      } catch {
        // WAL file may not exist
      }

      const tableNames = [
        'server_stats_requests',
        'server_stats_queries',
        'server_stats_events',
        'server_stats_emails',
        'server_stats_logs',
        'server_stats_traces',
        'server_stats_metrics',
        'server_stats_saved_filters',
      ]

      // Single transaction for all 8 COUNT queries — 1 pool acquire instead of 8
      const tables: Array<{ name: string; rowCount: number }> = await this.db!.transaction(
        async (trx) => {
          const result: Array<{ name: string; rowCount: number }> = []
          for (const name of tableNames) {
            try {
              const [row] = await trx(name).count('* as count')
              result.push({ name, rowCount: Number(row.count) })
            } catch {
              result.push({ name, rowCount: 0 })
            }
          }
          return result
        }
      )

      const stats = {
        ready: true as const,
        dbPath: this.config.dbPath,
        fileSizeMb,
        walSizeMb,
        retentionDays: this.config.retentionDays,
        tables,
        lastCleanupAt: this.lastCleanupAt,
      }

      this.cachedStorageStats = { data: stats, cachedAt: Date.now() }
      return stats
    })
  }

  // =========================================================================
  // Write methods — queued writes with batch flushing
  // =========================================================================

  /**
   * Queue a full request (with queries, events, trace) for batch persistence.
   * Returns null immediately — actual IDs are assigned during flush.
   *
   * Writes are buffered and flushed every 500ms in a single transaction,
   * which prevents the single-connection pool from being overwhelmed by
   * individual fire-and-forget INSERT calls under load.
   */
  persistRequest(input: PersistRequestInput): Promise<number | null> {
    if (!this.db) return Promise.resolve(null)
    if (input.url.startsWith(this.dashboardPath)) return Promise.resolve(null)

    // Drop oldest entries if queue is too deep (backpressure)
    if (this.writeQueue.length >= DashboardStore.MAX_QUEUE_SIZE) {
      this.writeQueue.splice(0, Math.floor(DashboardStore.MAX_QUEUE_SIZE / 4))
    }

    this.writeQueue.push(input)
    this.scheduleFlush()
    return Promise.resolve(null)
  }

  /** Queue events to be attached to a request during flush. */
  queueEvents(requestIndex: number, events: EventRecord[]): void {
    if (events.length === 0) return
    this.pendingEvents.push({ requestIndex, events })
  }

  /** Record a single log entry — queued for batch flush. */
  recordLog(entry: Record<string, unknown>): void {
    if (!this.db) return

    // Drop oldest if too many pending
    if (this.pendingLogs.length >= DashboardStore.MAX_QUEUE_SIZE) {
      this.pendingLogs.splice(0, Math.floor(DashboardStore.MAX_QUEUE_SIZE / 4))
    }

    this.pendingLogs.push(entry)
    this.scheduleFlush()
  }

  /** Record a single email — queued for batch flush (avoids bypassing the write queue). */
  recordEmail(record: EmailRecord): void {
    if (!this.db) return

    if (this.pendingEmails.length >= DashboardStore.MAX_QUEUE_SIZE) {
      this.pendingEmails.splice(0, Math.floor(DashboardStore.MAX_QUEUE_SIZE / 4))
    }

    this.pendingEmails.push(record)
    this.scheduleFlush()
  }

  /** Schedule the next batch flush if not already scheduled. */
  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushWriteQueue().catch((err) => {
        if (!warnedWritePaths.has('flush')) {
          warnedWritePaths.add('flush')
          log.warn(`dashboard: flush failed — ${(err as Error)?.message}`)
        }
      })
    }, DashboardStore.FLUSH_INTERVAL_MS)
  }

  /**
   * Flush all pending writes in a single transaction.
   *
   * A transaction acquires the pool connection ONCE, runs all INSERTs
   * (synchronous via better-sqlite3), then releases. Without a
   * transaction, each INSERT does its own async acquire/release cycle —
   * under load this creates hundreds of microtasks that starve the
   * event loop and freeze the server.
   */
  private async flushWriteQueue(): Promise<void> {
    if (this.flushing || !this.db) return
    this.flushing = true

    // Snapshot and clear the queues
    const requests = this.writeQueue.splice(0)
    const logs = this.pendingLogs.splice(0)
    const events = this.pendingEvents.splice(0)
    const emails = this.pendingEmails.splice(0)

    if (requests.length === 0 && logs.length === 0 && events.length === 0 && emails.length === 0) {
      this.flushing = false
      return
    }

    // Pre-stringify JSON OUTSIDE the transaction so the synchronous
    // better-sqlite3 execution doesn't block the event loop on large spans.
    const preparedRequests = requests.map((input) => ({
      input,
      filteredQueries: input.queries
        .filter((q) => q.connection !== 'server_stats')
        .map((q) => ({
          sql_text: q.sql,
          sql_normalized: normalizeSql(q.sql),
          bindings: q.bindings ? JSON.stringify(q.bindings) : null,
          duration: round(q.duration),
          method: q.method,
          model: q.model,
          connection: q.connection,
          in_transaction: q.inTransaction ? 1 : 0,
        })),
      traceRow: input.trace
        ? {
            method: input.trace.method,
            url: input.trace.url,
            status_code: input.trace.statusCode,
            total_duration: round(input.trace.totalDuration),
            span_count: input.trace.spanCount,
            spans: JSON.stringify(input.trace.spans),
            warnings: input.trace.warnings.length > 0 ? JSON.stringify(input.trace.warnings) : null,
          }
        : null,
    }))

    const preparedLogs = logs.map((entry) => {
      const levelName =
        typeof entry.levelName === 'string' ? entry.levelName : String(entry.level || 'unknown')
      return {
        level: levelName,
        message: String(entry.msg || entry.message || ''),
        request_id:
          entry.request_id || entry.requestId || entry['x-request-id']
            ? String(entry.request_id || entry.requestId || entry['x-request-id'])
            : null,
        data: JSON.stringify(entry),
      }
    })

    try {
      await this.db.transaction(async (trx) => {
        // -- Requests + queries + traces --
        for (const { input, filteredQueries, traceRow } of preparedRequests) {
          try {
            const [requestId] = await trx('server_stats_requests').insert({
              method: input.method,
              url: input.url,
              status_code: input.statusCode,
              duration: round(input.duration),
              span_count: input.trace?.spanCount ?? 0,
              warning_count: input.trace?.warnings?.length ?? 0,
            })

            if (requestId !== null && requestId !== undefined && filteredQueries.length > 0) {
              const rows = filteredQueries.map((q) => ({ ...q, request_id: requestId }))
              for (let i = 0; i < rows.length; i += 50) {
                await trx('server_stats_queries').insert(rows.slice(i, i + 50))
              }
            }

            if (requestId !== null && requestId !== undefined && traceRow) {
              await trx('server_stats_traces').insert({ ...traceRow, request_id: requestId })
            }
          } catch (err) {
            if (!warnedWritePaths.has('persistRequest')) {
              warnedWritePaths.add('persistRequest')
              log.warn(`dashboard: persistRequest failed — ${(err as Error)?.message}`)
            }
          }
        }

        // -- Events --
        for (const { events: evts } of events) {
          try {
            const rows = evts.map((e) => ({
              request_id: null,
              event_name: e.event,
              data: e.data,
            }))
            for (let i = 0; i < rows.length; i += 50) {
              await trx('server_stats_events').insert(rows.slice(i, i + 50))
            }
          } catch (err) {
            if (!warnedWritePaths.has('recordEvents')) {
              warnedWritePaths.add('recordEvents')
              log.warn(`dashboard: recordEvents failed — ${(err as Error)?.message}`)
            }
          }
        }

        // -- Emails --
        if (emails.length > 0) {
          try {
            const rows = emails.map((record) => ({
              from_addr: record.from,
              to_addr: record.to,
              cc: record.cc,
              bcc: record.bcc,
              subject: record.subject,
              html: record.html,
              text_body: record.text,
              mailer: record.mailer,
              status: record.status,
              message_id: record.messageId,
              attachment_count: record.attachmentCount,
            }))
            for (let i = 0; i < rows.length; i += 50) {
              await trx('server_stats_emails').insert(rows.slice(i, i + 50))
            }
          } catch (err) {
            if (!warnedWritePaths.has('recordEmail')) {
              warnedWritePaths.add('recordEmail')
              log.warn(`dashboard: recordEmail failed — ${(err as Error)?.message}`)
            }
          }
        }

        // -- Logs --
        if (preparedLogs.length > 0) {
          try {
            for (let i = 0; i < preparedLogs.length; i += 50) {
              await trx('server_stats_logs').insert(preparedLogs.slice(i, i + 50))
            }
          } catch (err) {
            if (!warnedWritePaths.has('recordLog')) {
              warnedWritePaths.add('recordLog')
              log.warn(`dashboard: recordLog failed — ${(err as Error)?.message}`)
            }
          }
        }
      })
    } catch (err) {
      if (!warnedWritePaths.has('flush')) {
        warnedWritePaths.add('flush')
        log.warn(`dashboard: flush transaction failed — ${(err as Error)?.message}`)
      }
    } finally {
      this.flushing = false
    }

    // Yield to the event loop after the transaction so HTTP requests
    // and timers get a chance to run between flush cycles.
    await new Promise<void>((resolve) => setImmediate(resolve))

    // If more data arrived during flush, schedule another
    if (
      this.writeQueue.length > 0 ||
      this.pendingLogs.length > 0 ||
      this.pendingEmails.length > 0
    ) {
      this.scheduleFlush()
    }
  }

  // =========================================================================
  // Read methods — query data for dashboard API
  // =========================================================================

  /** Paginated request history with optional filters. */
  async getRequests(
    page: number = 1,
    perPage: number = 50,
    filters?: RequestFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const fk = filters ? JSON.stringify(filters) : ''
    return this.paginate(
      'server_stats_requests',
      page,
      perPage,
      (query) => {
        if (filters?.method) query.where('method', filters.method)
        if (filters?.url) query.where('url', 'like', `%${filters.url}%`)
        if (filters?.status) query.where('status_code', filters.status)
        if (filters?.statusMin) query.where('status_code', '>=', filters.statusMin)
        if (filters?.statusMax) query.where('status_code', '<=', filters.statusMax)
        if (filters?.durationMin) query.where('duration', '>=', filters.durationMin)
        if (filters?.durationMax) query.where('duration', '<=', filters.durationMax)
        if (filters?.search) {
          const term = `%${filters.search}%`
          query.where((qb) => {
            qb.where('url', 'like', term).orWhere('method', 'like', term)
          })
        }
      },
      fk
    )
  }

  /** Paginated query history with optional filters. */
  async getQueries(
    page: number = 1,
    perPage: number = 50,
    filters?: QueryFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const fk = filters ? JSON.stringify(filters) : ''
    return this.paginate(
      'server_stats_queries',
      page,
      perPage,
      (query) => {
        if (filters?.method) query.where('method', filters.method)
        if (filters?.model) query.where('model', filters.model)
        if (filters?.connection) query.where('connection', filters.connection)
        if (filters?.durationMin) query.where('duration', '>=', filters.durationMin)
        if (filters?.durationMax) query.where('duration', '<=', filters.durationMax)
        if (filters?.requestId) query.where('request_id', filters.requestId)
        if (filters?.search) {
          const term = `%${filters.search}%`
          query.where((qb) => {
            qb.where('sql_text', 'like', term)
              .orWhere('model', 'like', term)
              .orWhere('connection', 'like', term)
          })
        }
      },
      fk
    )
  }

  /**
   * Grouped query patterns: aggregated by sql_normalized
   * with count, avg/min/max/total duration.
   */
  async getQueriesGrouped(
    limit: number = 200,
    sort: string = 'total_duration',
    search?: string
  ): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    return this.cached(
      'queriesGrouped:' + limit + ':' + sort + ':' + (search || ''),
      DashboardStore.QUERIES_GROUPED_CACHE_TTL_MS,
      async () => {
        const validSorts: Record<string, string> = {
          count: 'count',
          avg_duration: 'avg_duration',
          total_duration: 'total_duration',
        }
        const orderCol = validSorts[sort] || 'total_duration'

        // Apply a time cutoff to avoid scanning the entire table
        const cutoff = rangeToCutoff('7d')

        const query = this.db!('server_stats_queries')
          .select(
            'sql_normalized',
            this.db!.raw('COUNT(*) as count'),
            this.db!.raw('ROUND(AVG(duration), 2) as avg_duration'),
            this.db!.raw('ROUND(MIN(duration), 2) as min_duration'),
            this.db!.raw('ROUND(MAX(duration), 2) as max_duration'),
            this.db!.raw('ROUND(SUM(duration), 2) as total_duration')
          )
          .where('created_at', '>=', cutoff)
          .groupBy('sql_normalized')
          .orderBy(orderCol, 'desc')
          .limit(limit)

        if (search) {
          query.where('sql_normalized', 'like', `%${search}%`)
        }

        return query
      }
    )
  }

  /** Paginated event history with optional filters. */
  async getEvents(
    page: number = 1,
    perPage: number = 50,
    filters?: EventFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const fk = filters ? JSON.stringify(filters) : ''
    return this.paginate(
      'server_stats_events',
      page,
      perPage,
      (query) => {
        if (filters?.eventName) query.where('event_name', 'like', `%${filters.eventName}%`)
        if (filters?.search) {
          query.where('event_name', 'like', `%${filters.search}%`)
        }
      },
      fk
    )
  }

  /** Paginated email history with optional filters. */
  async getEmails(
    page: number = 1,
    perPage: number = 50,
    filters?: EmailFilters,
    excludeBody: boolean = false
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const fk = (filters ? JSON.stringify(filters) : '') + (excludeBody ? ':noBody' : '')
    return this.paginate(
      'server_stats_emails',
      page,
      perPage,
      (query) => {
        if (filters?.search) {
          const term = `%${filters.search}%`
          query.where((sub) => {
            sub
              .where('from_addr', 'like', term)
              .orWhere('to_addr', 'like', term)
              .orWhere('subject', 'like', term)
          })
        }
        if (filters?.from) query.where('from_addr', 'like', `%${filters.from}%`)
        if (filters?.to) query.where('to_addr', 'like', `%${filters.to}%`)
        if (filters?.subject) query.where('subject', 'like', `%${filters.subject}%`)
        if (filters?.mailer) query.where('mailer', filters.mailer)
        if (filters?.status) query.where('status', filters.status)
        if (excludeBody) {
          query.select(
            'id',
            'from_addr',
            'to_addr',
            'cc',
            'bcc',
            'subject',
            'mailer',
            'status',
            'message_id',
            'attachment_count',
            'created_at'
          )
        }
      },
      fk
    )
  }

  /** Get email HTML body for preview (falls back to text_body). */
  async getEmailHtml(id: number): Promise<string | null> {
    if (!this.db) return null
    return this.coalesce('emailHtml:' + id, async () => {
      const row = await this.db!('server_stats_emails')
        .where('id', id)
        .select('html', 'text_body')
        .first()
      if (!row) return null
      return row.html || row.text_body || null
    })
  }

  /**
   * Paginated log history with structured search support.
   *
   * Structured filters query into the JSON `data` column using
   * SQLite's `json_extract()`.
   */
  async getLogs(
    page: number = 1,
    perPage: number = 50,
    filters?: LogFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const fk = filters ? JSON.stringify(filters) : ''
    return this.paginate(
      'server_stats_logs',
      page,
      perPage,
      (query) => {
        if (filters?.level) query.where('level', filters.level)
        if (filters?.requestId) query.where('request_id', filters.requestId)
        if (filters?.search) {
          query.where('message', 'like', `%${filters.search}%`)
        }
        if (filters?.structured && filters.structured.length > 0) {
          for (const sf of filters.structured) {
            const jsonPath = `$.${sf.field}`
            switch (sf.operator) {
              case 'equals':
                query.whereRaw(`json_extract(data, ?) = ?`, [jsonPath, sf.value])
                break
              case 'contains':
                query.whereRaw(`json_extract(data, ?) LIKE ?`, [jsonPath, `%${sf.value}%`])
                break
              case 'startsWith':
                query.whereRaw(`json_extract(data, ?) LIKE ?`, [jsonPath, `${sf.value}%`])
                break
            }
          }
        }
      },
      fk
    )
  }

  /** Paginated trace history with optional filters. */
  async getTraces(
    page: number = 1,
    perPage: number = 50,
    filters?: TraceFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const fk = filters ? JSON.stringify(filters) : ''
    return this.paginate(
      'server_stats_traces',
      page,
      perPage,
      (query) => {
        if (filters?.method) query.where('method', filters.method)
        if (filters?.url) query.where('url', 'like', `%${filters.url}%`)
        if (filters?.statusMin) query.where('status_code', '>=', filters.statusMin)
        if (filters?.statusMax) query.where('status_code', '<=', filters.statusMax)
        if (filters?.search) {
          const term = `%${filters.search}%`
          query.where((qb) => {
            qb.where('url', 'like', term).orWhere('method', 'like', term)
          })
        }
      },
      fk
    )
  }

  /** Single trace with full span data. */
  async getTraceDetail(id: number): Promise<Record<string, unknown> | null> {
    if (!this.db) return null

    return this.coalesce('traceDetail:' + id, async () => {
      const row = await this.db!('server_stats_traces').where('id', id).first()
      if (!row) return null

      return {
        ...row,
        spans: safeParseJson(row.spans) ?? [],
        warnings: safeParseJsonArray(row.warnings),
      }
    })
  }

  /**
   * Single request with associated queries, events, and trace.
   * Wrapped in a transaction — 1 pool acquire instead of 4.
   */
  async getRequestDetail(id: number): Promise<Record<string, unknown> | null> {
    if (!this.db) return null

    return this.coalesce('requestDetail:' + id, async () => {
      return this.db!.transaction(async (trx) => {
        const request = await trx('server_stats_requests').where('id', id).first()
        if (!request) return null

        const queries = await trx('server_stats_queries')
          .where('request_id', id)
          .orderBy('created_at', 'asc')
        const events = await trx('server_stats_events')
          .where('request_id', id)
          .orderBy('created_at', 'asc')
        const trace = await trx('server_stats_traces').where('request_id', id).first()

        return {
          ...request,
          queries,
          events,
          trace: trace
            ? {
                ...trace,
                spans: safeParseJson(trace.spans) ?? [],
                warnings: safeParseJsonArray(trace.warnings),
              }
            : null,
        }
      })
    })
  }

  // =========================================================================
  // Overview & Charts
  // =========================================================================

  /**
   * Aggregated overview metrics for the dashboard cards.
   *
   * @param range — '1h' | '6h' | '24h' | '7d'
   */
  /**
   * Wrapped in a single transaction — 1 pool acquire instead of 5.
   */
  async getOverviewMetrics(range: string = '1h'): Promise<Record<string, unknown> | null> {
    if (!this.db) return null

    return this.cached('overviewMetrics:' + range, 2_000, async () => {
      const cutoff = rangeToCutoff(range)

      const result = await this.db!.transaction(async (trx) => {
        const stats: Record<string, unknown> | undefined = await trx('server_stats_requests')
          .where('created_at', '>=', cutoff)
          .select(
            trx.raw('COUNT(*) as total'),
            trx.raw('ROUND(AVG(duration), 2) as avg_duration'),
            trx.raw('SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count')
          )
          .first()

        const total = Number(stats?.total ?? 0)
        if (total === 0) {
          return {
            avgResponseTime: 0,
            p95ResponseTime: 0,
            requestsPerMinute: 0,
            errorRate: 0,
            totalRequests: 0,
            slowestEndpoints: [],
            queryStats: { total: 0, avgDuration: 0, perRequest: 0 },
            recentErrors: [],
          }
        }

        const avgResponseTime = stats?.avg_duration as number
        const errorCount = Number(stats?.error_count ?? 0)
        const rangeMinutes = rangeToMinutes(range)
        const requestsPerMin = total / rangeMinutes

        const p95Offset = Math.floor(total * 0.95)
        const p95Row = await trx('server_stats_requests')
          .where('created_at', '>=', cutoff)
          .orderBy('duration', 'asc')
          .offset(Math.min(p95Offset, total - 1))
          .limit(1)
          .select('duration')
          .first()
        const p95ResponseTime = (p95Row?.duration as number) ?? 0

        const slowestEndpoints = await trx('server_stats_requests')
          .where('created_at', '>=', cutoff)
          .select(
            'url',
            trx.raw('COUNT(*) as count'),
            trx.raw('ROUND(AVG(duration), 2) as avg_duration')
          )
          .groupBy('url')
          .orderBy('avg_duration', 'desc')
          .limit(5)

        const queryStats: Record<string, unknown> | undefined = await trx('server_stats_queries')
          .where('created_at', '>=', cutoff)
          .select(trx.raw('COUNT(*) as total'), trx.raw('ROUND(AVG(duration), 2) as avg_duration'))
          .first()

        const recentErrors = await trx('server_stats_logs')
          .where('created_at', '>=', cutoff)
          .whereIn('level', ['error', 'fatal'])
          .orderBy('created_at', 'desc')
          .limit(5)

        return {
          avgResponseTime: round(avgResponseTime),
          p95ResponseTime: round(p95ResponseTime),
          requestsPerMinute: round(requestsPerMin),
          errorRate: round((errorCount / total) * 100),
          totalRequests: total,
          slowestEndpoints: slowestEndpoints.map((s: Record<string, unknown>) => ({
            url: s.url,
            count: s.count,
            avgDuration: s.avg_duration,
          })),
          queryStats: {
            total: (queryStats?.total as number) ?? 0,
            avgDuration: (queryStats?.avg_duration as number) ?? 0,
            perRequest: total > 0 ? round(((queryStats?.total as number) ?? 0) / total) : 0,
          },
          recentErrors: recentErrors.map((e: Record<string, unknown>) => ({
            id: e.id,
            message: e.message,
            createdAt: e.created_at,
          })),
        }
      })

      return result
    })
  }

  /**
   * Time-series chart data from server_stats_metrics.
   *
   * @param range — '1h' | '6h' | '24h' | '7d'
   */
  async getChartData(range: string = '1h'): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    return this.cached('chartData:' + range, DashboardStore.CHART_CACHE_TTL_MS, async () => {
      const cutoff = rangeToCutoff(range)

      // For 1h/6h, use the per-minute metrics table.
      // For 24h/7d, aggregate metrics into larger buckets.
      const rows = await this.db!('server_stats_metrics')
        .where('bucket', '>=', cutoff)
        .orderBy('bucket', 'asc')

      if (range === '1h' || range === '6h') {
        return rows
      }

      // For 24h: group by 15-minute buckets; for 7d: group by hourly buckets
      const bucketMinutes = range === '7d' ? 60 : 15
      interface MetricsBucket {
        bucket: string
        request_count: number
        avg_duration: number
        p95_duration: number
        error_count: number
        query_count: number
        avg_query_duration: number
        _count: number
      }
      const grouped = new Map<string, MetricsBucket>()

      for (const row of rows) {
        const bucketKey = roundBucket(row.bucket as string, bucketMinutes)
        if (!grouped.has(bucketKey)) {
          grouped.set(bucketKey, {
            bucket: bucketKey,
            request_count: 0,
            avg_duration: 0,
            p95_duration: 0,
            error_count: 0,
            query_count: 0,
            avg_query_duration: 0,
            _count: 0,
          })
        }
        const g = grouped.get(bucketKey)!
        g.request_count += row.request_count as number
        g.error_count += row.error_count as number
        g.query_count += row.query_count as number
        g.avg_duration += row.avg_duration as number
        g.p95_duration = Math.max(g.p95_duration, row.p95_duration as number)
        g.avg_query_duration += row.avg_query_duration as number
        g._count++
      }

      return Array.from(grouped.values()).map((g) => ({
        bucket: g.bucket,
        request_count: g.request_count,
        avg_duration: g._count > 0 ? round(g.avg_duration / g._count) : 0,
        p95_duration: round(g.p95_duration),
        error_count: g.error_count,
        query_count: g.query_count,
        avg_query_duration: g._count > 0 ? round(g.avg_query_duration / g._count) : 0,
      }))
    })
  }

  /**
   * Widget data for the dashboard overview.
   *
   * @param range — '1h' | '6h' | '24h' | '7d'
   */
  async getOverviewWidgets(range: string = '1h'): Promise<{
    topEvents: { eventName: string; count: number }[]
    emailActivity: { sent: number; queued: number; failed: number }
    logLevelBreakdown: { error: number; warn: number; info: number; debug: number }
    statusDistribution: { '2xx': number; '3xx': number; '4xx': number; '5xx': number }
    slowestQueries: { sqlNormalized: string; avgDuration: number; count: number }[]
  }> {
    const empty = {
      topEvents: [] as { eventName: string; count: number }[],
      emailActivity: { sent: 0, queued: 0, failed: 0 },
      logLevelBreakdown: { error: 0, warn: 0, info: 0, debug: 0 },
      statusDistribution: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
      slowestQueries: [] as { sqlNormalized: string; avgDuration: number; count: number }[],
    }

    if (!this.db) return empty

    return this.cached(
      'overviewWidgets:' + range,
      DashboardStore.WIDGETS_CACHE_TTL_MS,
      async () => {
        const cutoff = rangeToCutoff(range)

        try {
          // Single transaction — 1 pool acquire instead of 5.
          const { topEventsRaw, emailStatusRaw, logLevelsRaw, statusRaw, slowQueriesRaw } =
            await this.db!.transaction(async (trx) => ({
              topEventsRaw: await trx('server_stats_events')
                .select('event_name', trx.raw('COUNT(*) as count'))
                .where('created_at', '>=', cutoff)
                .groupBy('event_name')
                .orderBy('count', 'desc')
                .limit(5),

              emailStatusRaw: await trx('server_stats_emails')
                .select('status', trx.raw('COUNT(*) as count'))
                .where('created_at', '>=', cutoff)
                .groupBy('status'),

              logLevelsRaw: await trx('server_stats_logs')
                .select('level', trx.raw('COUNT(*) as count'))
                .where('created_at', '>=', cutoff)
                .groupBy('level'),

              statusRaw: await trx('server_stats_requests')
                .select(
                  trx.raw(
                    `SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as "s2xx"`
                  ),
                  trx.raw(
                    `SUM(CASE WHEN status_code >= 300 AND status_code < 400 THEN 1 ELSE 0 END) as "s3xx"`
                  ),
                  trx.raw(
                    `SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) as "s4xx"`
                  ),
                  trx.raw(
                    `SUM(CASE WHEN status_code >= 500 AND status_code < 600 THEN 1 ELSE 0 END) as "s5xx"`
                  )
                )
                .where('created_at', '>=', cutoff)
                .first(),

              slowQueriesRaw: await trx('server_stats_queries')
                .select(
                  'sql_normalized',
                  trx.raw('ROUND(AVG(duration), 2) as avg_duration'),
                  trx.raw('COUNT(*) as count')
                )
                .where('created_at', '>=', cutoff)
                .groupBy('sql_normalized')
                .orderBy('avg_duration', 'desc')
                .limit(5),
            }))

          // Map top events
          const topEvents = (topEventsRaw || []).map((r: Record<string, unknown>) => ({
            eventName: r.event_name as string,
            count: r.count as number,
          }))

          // Map email activity
          const emailActivity = { sent: 0, queued: 0, failed: 0 }
          for (const row of emailStatusRaw || []) {
            const status = row.status as string
            const count = row.count as number
            if (status === 'sent') emailActivity.sent = count
            else if (status === 'queued') emailActivity.queued = count
            else if (status === 'failed') emailActivity.failed = count
          }

          // Map log level breakdown
          const logLevelBreakdown = { error: 0, warn: 0, info: 0, debug: 0 }
          for (const row of logLevelsRaw || []) {
            const level = row.level as string
            if (level in logLevelBreakdown) {
              logLevelBreakdown[level as keyof typeof logLevelBreakdown] = row.count as number
            }
          }

          // Map status distribution
          const statusDistribution = {
            '2xx': statusRaw?.s2xx ?? 0,
            '3xx': statusRaw?.s3xx ?? 0,
            '4xx': statusRaw?.s4xx ?? 0,
            '5xx': statusRaw?.s5xx ?? 0,
          }

          // Map slowest queries
          const slowestQueries = (slowQueriesRaw || []).map((r: Record<string, unknown>) => ({
            sqlNormalized: r.sql_normalized as string,
            avgDuration: r.avg_duration as number,
            count: r.count as number,
          }))

          return { topEvents, emailActivity, logLevelBreakdown, statusDistribution, slowestQueries }
        } catch (err) {
          if (!overviewWidgetWarned) {
            overviewWidgetWarned = true
            log.warn('dashboard: getOverviewWidgets query failed — ' + (err as Error)?.message)
          }
          return empty
        }
      }
    )
  }

  /** Get sparkline data points from pre-aggregated metrics. */
  async getSparklineData(range: string): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    return this.cached('sparkline:' + range, DashboardStore.SPARKLINE_CACHE_TTL_MS, async () => {
      const cutoff = rangeToCutoff(range)
      const metrics: Record<string, unknown>[] = await this.db!('server_stats_metrics')
        .where('bucket', '>=', cutoff)
        .orderBy('bucket', 'asc')

      return metrics.slice(-15)
    })
  }

  // =========================================================================
  // Saved filters CRUD
  // =========================================================================

  async getSavedFilters(section?: string): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    return this.coalesce('savedFilters:' + (section || ''), async () => {
      const query = this.db!('server_stats_saved_filters').orderBy('created_at', 'desc')
      if (section) query.where('section', section)
      return query
    })
  }

  async createSavedFilter(
    name: string,
    section: string,
    filterConfig: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    if (!this.db) return null

    const [id] = await this.db('server_stats_saved_filters').insert({
      name,
      section,
      filter_config: JSON.stringify(filterConfig),
    })

    return { id, name, section, filterConfig }
  }

  async deleteSavedFilter(id: number): Promise<boolean> {
    if (!this.db) return false

    const deleted = await this.db('server_stats_saved_filters').where('id', id).delete()
    return deleted > 0
  }

  // =========================================================================
  // EXPLAIN
  // =========================================================================

  /**
   * Run EXPLAIN on a stored query using the app's default database connection.
   * Only allows SELECT queries for safety.
   *
   * @param queryId — ID from server_stats_queries
   * @param appDb — The application's Lucid database manager
   */
  async runExplain(queryId: number, appDb: unknown): Promise<Record<string, unknown> | null> {
    if (!this.db) return { error: 'Dashboard store not initialized' }

    return this.coalesce('explain:' + queryId, async () => {
      const row = await this.db!('server_stats_queries').where('id', queryId).first()
      if (!row) return { error: 'Query not found' }

      const sql = row.sql_text.trim()
      if (!sql.toLowerCase().startsWith('select')) {
        return { error: 'EXPLAIN is only supported for SELECT queries' }
      }

      try {
        const result = await (
          appDb as { rawQuery: (sql: string) => Promise<{ rows?: unknown[] }> }
        ).rawQuery(`EXPLAIN ${sql}`)
        return { plan: result.rows || result }
      } catch (err) {
        return { error: (err as Error).message || 'EXPLAIN failed' }
      }
    })
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Generic paginated query with filter callback.
   *
   * Wrapped in a single transaction so COUNT + SELECT acquire the pool
   * connection only once instead of two separate acquire/release cycles.
   * With max:1 pool, this halves pool pressure per paginated endpoint.
   */
  private async paginate(
    table: string,
    page: number,
    perPage: number,
    applyFilters?: (query: Knex.QueryBuilder) => void,
    filterKey?: string
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    if (!this.db) {
      return { data: [], total: 0, page, perPage, lastPage: 0 }
    }

    const coalesceKey = 'paginate:' + table + ':' + page + ':' + perPage + ':' + (filterKey || '')

    return this.cached(coalesceKey, DashboardStore.PAGINATE_CACHE_TTL_MS, async () => {
      return this.db!.transaction(async (trx) => {
        const countQuery = trx(table)
        if (applyFilters) applyFilters(countQuery)
        const [{ count: totalRaw }] = await countQuery.count('* as count')
        const total = Number(totalRaw)

        const offset = (page - 1) * perPage
        const dataQuery = trx(table).orderBy('created_at', 'desc').limit(perPage).offset(offset)
        if (applyFilters) applyFilters(dataQuery)
        const data = await dataQuery

        return { data, total, page, perPage, lastPage: Math.ceil(total / perPage) }
      })
    })
  }

  /**
   * Wire email event listeners to persist emails as they arrive.
   */
  private wireEventListeners(): void {
    if (!this.emitter || typeof this.emitter.on !== 'function') {
      log.warn('dashboard: emitter not available — email collection disabled')
      return
    }

    const buildAndPersistEmail = (data: unknown, status: EmailRecord['status']) => {
      const d = data as Record<string, unknown> | undefined
      const msg = (d?.message || d) as Record<string, unknown> | undefined
      const record = {
        from: extractAddresses(msg?.from) || 'unknown',
        to: extractAddresses(msg?.to) || 'unknown',
        cc: extractAddresses(msg?.cc) || null,
        bcc: extractAddresses(msg?.bcc) || null,
        subject: (msg?.subject as string) || '(no subject)',
        html: (msg?.html as string) || null,
        text: (msg?.text as string) || null,
        mailer: (d?.mailerName as string) || (d?.mailer as string) || 'unknown',
        status,
        messageId:
          ((d?.response as Record<string, unknown>)?.messageId as string) ||
          (d?.messageId as string) ||
          null,
        attachmentCount: Array.isArray(msg?.attachments)
          ? (msg.attachments as unknown[]).length
          : 0,
        timestamp: Date.now(),
      } as EmailRecord
      this.recordEmail(record)
    }

    this.handlers = [
      { event: 'mail:sending', fn: (data: unknown) => buildAndPersistEmail(data, 'sending') },
      { event: 'mail:sent', fn: (data: unknown) => buildAndPersistEmail(data, 'sent') },
      { event: 'mail:queued', fn: (data: unknown) => buildAndPersistEmail(data, 'queued') },
      { event: 'queued:mail:error', fn: (data: unknown) => buildAndPersistEmail(data, 'failed') },
    ]

    for (const h of this.handlers) {
      this.emitter.on(h.event, h.fn)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a SQL query by replacing literal values with `?` placeholders.
 * Used for grouping identical query patterns.
 */
function normalizeSql(sql: string): string {
  return sql
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
}
