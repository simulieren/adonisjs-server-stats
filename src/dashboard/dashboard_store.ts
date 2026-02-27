import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { safeParseJson, safeParseJsonArray } from '../utils/json_helpers.js'
import { log } from '../utils/logger.js'
import { extractAddresses } from '../utils/mail_helpers.js'
import { round } from '../utils/math_helpers.js'
import { rangeToCutoff, rangeToMinutes, roundBucket } from '../utils/time_helpers.js'
import { ChartAggregator } from './chart_aggregator.js'
import { autoMigrate, runRetentionCleanup } from './migrator.js'

import type { Knex } from 'knex'

import type { DevToolbarConfig } from '../debug/types.js'
import type { QueryRecord, EventRecord, EmailRecord, TraceRecord } from '../debug/types.js'

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export interface RequestFilters {
  method?: string
  url?: string
  status?: number
  statusMin?: number
  statusMax?: number
  durationMin?: number
  durationMax?: number
}

export interface QueryFilters {
  method?: string
  model?: string
  connection?: string
  durationMin?: number
  durationMax?: number
  requestId?: number
}

export interface EventFilters {
  eventName?: string
}

export interface EmailFilters {
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
  private db: any = null
  private emitter: any = null
  private config: DevToolbarConfig
  private dashboardPath: string
  private retentionTimer: ReturnType<typeof setInterval> | null = null
  private chartAggregator: ChartAggregator | null = null
  private handlers: { event: string; fn: (...args: unknown[]) => void }[] = []

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
  async start(_lucidDb: any, emitter: any, appRoot: string): Promise<void> {
    this.emitter = emitter

    const dbFilePath = appRoot + '/' + this.config.dbPath
    await mkdir(dirname(dbFilePath), { recursive: true })

    // Create a standalone Knex connection to SQLite — bypasses Lucid's
    // connection manager entirely so we never pollute the app's pool.
    const knexModule = await import('knex')
    const knexFactory = knexModule.default ?? knexModule
    this.db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: dbFilePath },
      useNullAsDefault: true,
    })

    await this.db.raw('PRAGMA journal_mode=WAL')
    await this.db.raw('PRAGMA foreign_keys=ON')

    await autoMigrate(this.db)
    await runRetentionCleanup(this.db, this.config.retentionDays)

    // Hourly retention cleanup
    this.retentionTimer = setInterval(
      async () => {
        try {
          await runRetentionCleanup(this.db, this.config.retentionDays)
        } catch (err) {
          log.warn('dashboard: retention cleanup failed — ' + (err as Error)?.message)
        }
      },
      60 * 60 * 1000
    )

    // Start chart aggregation (every 60s)
    this.chartAggregator = new ChartAggregator(this.db)
    this.chartAggregator.start()

    // Wire email event listeners
    this.wireEventListeners()
  }

  /** Shut down timers, event listeners, and database connection. */
  async stop(): Promise<void> {
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
  getDb(): any {
    return this.db
  }

  /** Whether the store is initialized and ready. */
  isReady(): boolean {
    return this.db !== null
  }

  // =========================================================================
  // Write methods — persist data from collectors
  // =========================================================================

  /**
   * Record a completed request. Returns the inserted row ID, or null
   * if the request was self-excluded or an error occurred.
   */
  async recordRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    spanCount: number = 0,
    warningCount: number = 0
  ): Promise<number | null> {
    if (!this.db) return null
    if (url.startsWith(this.dashboardPath)) return null

    try {
      const [id] = await this.db('server_stats_requests').insert({
        method,
        url,
        status_code: statusCode,
        duration: round(duration),
        span_count: spanCount,
        warning_count: warningCount,
      })
      return id
    } catch (err) {
      const method_ = 'recordRequest'
      if (!warnedWritePaths.has(method_)) {
        warnedWritePaths.add(method_)
        log.warn(`dashboard: ${method_} failed — ${(err as Error)?.message}`)
      }
      return null
    }
  }

  /** Batch-insert queries for a request. Filters out server_stats connection queries. */
  async recordQueries(requestId: number, queries: QueryRecord[]): Promise<void> {
    if (!this.db || queries.length === 0) return

    const filtered = queries.filter((q) => q.connection !== 'server_stats')
    if (filtered.length === 0) return

    try {
      const rows = filtered.map((q) => ({
        request_id: requestId,
        sql_text: q.sql,
        sql_normalized: normalizeSql(q.sql),
        bindings: q.bindings ? JSON.stringify(q.bindings) : null,
        duration: round(q.duration),
        method: q.method,
        model: q.model,
        connection: q.connection,
        in_transaction: q.inTransaction ? 1 : 0,
      }))

      // SQLite variable limit: batch in chunks of 50
      for (let i = 0; i < rows.length; i += 50) {
        await this.db('server_stats_queries').insert(rows.slice(i, i + 50))
      }
    } catch (err) {
      const method = 'recordQueries'
      if (!warnedWritePaths.has(method)) {
        warnedWritePaths.add(method)
        log.warn(`dashboard: ${method} failed — ${(err as Error)?.message}`)
      }
    }
  }

  /** Batch-insert events for a request. */
  async recordEvents(requestId: number, events: EventRecord[]): Promise<void> {
    if (!this.db || events.length === 0) return

    try {
      const rows = events.map((e) => ({
        request_id: requestId,
        event_name: e.event,
        data: e.data,
      }))

      for (let i = 0; i < rows.length; i += 50) {
        await this.db('server_stats_events').insert(rows.slice(i, i + 50))
      }
    } catch (err) {
      const method = 'recordEvents'
      if (!warnedWritePaths.has(method)) {
        warnedWritePaths.add(method)
        log.warn(`dashboard: ${method} failed — ${(err as Error)?.message}`)
      }
    }
  }

  /** Record a single email. */
  async recordEmail(record: EmailRecord): Promise<void> {
    if (!this.db) return

    try {
      await this.db('server_stats_emails').insert({
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
      })
    } catch (err) {
      const method = 'recordEmail'
      if (!warnedWritePaths.has(method)) {
        warnedWritePaths.add(method)
        log.warn(`dashboard: ${method} failed — ${(err as Error)?.message}`)
      }
    }
  }

  /** Record a single log entry (from LogStreamService). */
  async recordLog(entry: Record<string, unknown>): Promise<void> {
    if (!this.db) return

    try {
      const levelName =
        typeof entry.levelName === 'string' ? entry.levelName : String(entry.level || 'unknown')

      await this.db('server_stats_logs').insert({
        level: levelName,
        message: String(entry.msg || entry.message || ''),
        request_id: entry.requestId ? String(entry.requestId) : null,
        data: JSON.stringify(entry),
      })
    } catch (err) {
      const method = 'recordLog'
      if (!warnedWritePaths.has(method)) {
        warnedWritePaths.add(method)
        log.warn(`dashboard: ${method} failed — ${(err as Error)?.message}`)
      }
    }
  }

  /** Record a trace for a request. */
  async recordTrace(requestId: number, trace: TraceRecord): Promise<void> {
    if (!this.db) return

    try {
      await this.db('server_stats_traces').insert({
        request_id: requestId,
        method: trace.method,
        url: trace.url,
        status_code: trace.statusCode,
        total_duration: round(trace.totalDuration),
        span_count: trace.spanCount,
        spans: JSON.stringify(trace.spans),
        warnings: trace.warnings.length > 0 ? JSON.stringify(trace.warnings) : null,
      })
    } catch (err) {
      const method = 'recordTrace'
      if (!warnedWritePaths.has(method)) {
        warnedWritePaths.add(method)
        log.warn(`dashboard: ${method} failed — ${(err as Error)?.message}`)
      }
    }
  }

  /**
   * Convenience: persist a full request with associated queries and trace.
   * Calls recordRequest, recordQueries, and recordTrace in sequence.
   */
  async persistRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    queries: QueryRecord[],
    trace: TraceRecord | null
  ): Promise<number | null> {
    const requestId = await this.recordRequest(
      method,
      url,
      statusCode,
      duration,
      trace?.spanCount ?? 0,
      trace?.warnings?.length ?? 0
    )

    if (requestId === null) return null

    await this.recordQueries(requestId, queries)
    if (trace) {
      await this.recordTrace(requestId, trace)
    }

    return requestId
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
    return this.paginate('server_stats_requests', page, perPage, (query) => {
      if (filters?.method) query.where('method', filters.method)
      if (filters?.url) query.where('url', 'like', `%${filters.url}%`)
      if (filters?.status) query.where('status_code', filters.status)
      if (filters?.statusMin) query.where('status_code', '>=', filters.statusMin)
      if (filters?.statusMax) query.where('status_code', '<=', filters.statusMax)
      if (filters?.durationMin) query.where('duration', '>=', filters.durationMin)
      if (filters?.durationMax) query.where('duration', '<=', filters.durationMax)
    })
  }

  /** Paginated query history with optional filters. */
  async getQueries(
    page: number = 1,
    perPage: number = 50,
    filters?: QueryFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.paginate('server_stats_queries', page, perPage, (query) => {
      if (filters?.method) query.where('method', filters.method)
      if (filters?.model) query.where('model', filters.model)
      if (filters?.connection) query.where('connection', filters.connection)
      if (filters?.durationMin) query.where('duration', '>=', filters.durationMin)
      if (filters?.durationMax) query.where('duration', '<=', filters.durationMax)
      if (filters?.requestId) query.where('request_id', filters.requestId)
    })
  }

  /**
   * Grouped query patterns: aggregated by sql_normalized
   * with count, avg/min/max/total duration.
   */
  async getQueriesGrouped(limit: number = 200, sort: string = 'total_duration'): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    const validSorts: Record<string, string> = {
      count: 'count',
      avg_duration: 'avg_duration',
      total_duration: 'total_duration',
    }
    const orderCol = validSorts[sort] || 'total_duration'

    return this.db('server_stats_queries')
      .select(
        'sql_normalized',
        this.db.raw('COUNT(*) as count'),
        this.db.raw('ROUND(AVG(duration), 2) as avg_duration'),
        this.db.raw('ROUND(MIN(duration), 2) as min_duration'),
        this.db.raw('ROUND(MAX(duration), 2) as max_duration'),
        this.db.raw('ROUND(SUM(duration), 2) as total_duration')
      )
      .groupBy('sql_normalized')
      .orderBy(orderCol, 'desc')
      .limit(limit)
  }

  /** Paginated event history with optional filters. */
  async getEvents(
    page: number = 1,
    perPage: number = 50,
    filters?: EventFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.paginate('server_stats_events', page, perPage, (query) => {
      if (filters?.eventName) query.where('event_name', 'like', `%${filters.eventName}%`)
    })
  }

  /** Paginated email history with optional filters. */
  async getEmails(
    page: number = 1,
    perPage: number = 50,
    filters?: EmailFilters,
    excludeBody: boolean = false
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.paginate('server_stats_emails', page, perPage, (query) => {
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
    })
  }

  /** Get email HTML body for preview (falls back to text_body). */
  async getEmailHtml(id: number): Promise<string | null> {
    if (!this.db) return null
    const row = await this.db('server_stats_emails')
      .where('id', id)
      .select('html', 'text_body')
      .first()
    if (!row) return null
    return row.html || row.text_body || null
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
    return this.paginate('server_stats_logs', page, perPage, (query) => {
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
    })
  }

  /** Paginated trace history with optional filters. */
  async getTraces(
    page: number = 1,
    perPage: number = 50,
    filters?: TraceFilters
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.paginate('server_stats_traces', page, perPage, (query) => {
      if (filters?.method) query.where('method', filters.method)
      if (filters?.url) query.where('url', 'like', `%${filters.url}%`)
      if (filters?.statusMin) query.where('status_code', '>=', filters.statusMin)
      if (filters?.statusMax) query.where('status_code', '<=', filters.statusMax)
    })
  }

  /** Single trace with full span data. */
  async getTraceDetail(id: number): Promise<Record<string, unknown> | null> {
    if (!this.db) return null

    const row = await this.db('server_stats_traces').where('id', id).first()
    if (!row) return null

    return {
      ...row,
      spans: safeParseJson(row.spans) ?? [],
      warnings: safeParseJsonArray(row.warnings),
    }
  }

  /** Single request with associated queries, events, and trace. */
  async getRequestDetail(id: number): Promise<Record<string, unknown> | null> {
    if (!this.db) return null

    const request = await this.db('server_stats_requests').where('id', id).first()
    if (!request) return null

    const [queries, events, trace] = await Promise.all([
      this.db('server_stats_queries').where('request_id', id).orderBy('created_at', 'asc'),
      this.db('server_stats_events').where('request_id', id).orderBy('created_at', 'asc'),
      this.db('server_stats_traces').where('request_id', id).first(),
    ])

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
  }

  // =========================================================================
  // Overview & Charts
  // =========================================================================

  /**
   * Aggregated overview metrics for the dashboard cards.
   *
   * @param range — '1h' | '6h' | '24h' | '7d'
   */
  async getOverviewMetrics(range: string = '1h'): Promise<Record<string, unknown> | null> {
    if (!this.db) return null

    const cutoff = rangeToCutoff(range)

    // Recent requests for calculations
    const requests: Record<string, unknown>[] = await this.db('server_stats_requests')
      .where('created_at', '>=', cutoff)
      .select('duration', 'status_code', 'url', 'created_at')

    const total = requests.length
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

    const durations = requests.map((r) => r.duration as number).sort((a, b) => a - b)
    const avgResponseTime = durations.reduce((s, d) => s + d, 0) / total
    const p95Index = Math.floor(total * 0.95)
    const p95ResponseTime = durations[Math.min(p95Index, total - 1)]
    const errorCount = requests.filter((r) => (r.status_code as number) >= 400).length
    const rangeMinutes = rangeToMinutes(range)
    const requestsPerMin = total / rangeMinutes

    // Slowest endpoints (top 5 by average duration)
    const slowestEndpoints = await this.db('server_stats_requests')
      .where('created_at', '>=', cutoff)
      .select(
        'url',
        this.db.raw('COUNT(*) as count'),
        this.db.raw('ROUND(AVG(duration), 2) as avg_duration')
      )
      .groupBy('url')
      .orderBy('avg_duration', 'desc')
      .limit(5)

    // Query stats
    const queryStats: Record<string, unknown> | undefined = await this.db('server_stats_queries')
      .where('created_at', '>=', cutoff)
      .select(
        this.db.raw('COUNT(*) as total'),
        this.db.raw('ROUND(AVG(duration), 2) as avg_duration')
      )
      .first()

    // Recent errors (last 5 log entries with level error/fatal)
    const recentErrors = await this.db('server_stats_logs')
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
  }

  /**
   * Time-series chart data from server_stats_metrics.
   *
   * @param range — '1h' | '6h' | '24h' | '7d'
   */
  async getChartData(range: string = '1h'): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    const cutoff = rangeToCutoff(range)

    // For 1h/6h, use the per-minute metrics table.
    // For 24h/7d, aggregate metrics into larger buckets.
    const rows = await this.db('server_stats_metrics')
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

    const cutoff = rangeToCutoff(range)

    try {
      const [topEventsRaw, emailStatusRaw, logLevelsRaw, statusRaw, slowQueriesRaw] =
        await Promise.all([
          // Top 5 events by count
          this.db('server_stats_events')
            .select('event_name', this.db.raw('COUNT(*) as count'))
            .where('created_at', '>=', cutoff)
            .groupBy('event_name')
            .orderBy('count', 'desc')
            .limit(5),

          // Email activity by status
          this.db('server_stats_emails')
            .select('status', this.db.raw('COUNT(*) as count'))
            .where('created_at', '>=', cutoff)
            .groupBy('status'),

          // Log level breakdown
          this.db('server_stats_logs')
            .select('level', this.db.raw('COUNT(*) as count'))
            .where('created_at', '>=', cutoff)
            .groupBy('level'),

          // Status code distribution bucketed into 2xx/3xx/4xx/5xx
          this.db('server_stats_requests')
            .select(
              this.db.raw(
                `SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as "s2xx"`
              ),
              this.db.raw(
                `SUM(CASE WHEN status_code >= 300 AND status_code < 400 THEN 1 ELSE 0 END) as "s3xx"`
              ),
              this.db.raw(
                `SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) as "s4xx"`
              ),
              this.db.raw(
                `SUM(CASE WHEN status_code >= 500 AND status_code < 600 THEN 1 ELSE 0 END) as "s5xx"`
              )
            )
            .where('created_at', '>=', cutoff)
            .first(),

          // Slowest queries by avg duration (top 5)
          this.db('server_stats_queries')
            .select(
              'sql_normalized',
              this.db.raw('ROUND(AVG(duration), 2) as avg_duration'),
              this.db.raw('COUNT(*) as count')
            )
            .where('created_at', '>=', cutoff)
            .groupBy('sql_normalized')
            .orderBy('avg_duration', 'desc')
            .limit(5),
        ])

      // Map top events
      const topEvents = (topEventsRaw || []).map((r: Record<string, unknown>) => ({
        eventName: r.event_name,
        count: r.count,
      }))

      // Map email activity
      const emailActivity = { sent: 0, queued: 0, failed: 0 }
      for (const row of emailStatusRaw || []) {
        const status = row.status as string
        if (status === 'sent') emailActivity.sent = row.count
        else if (status === 'queued') emailActivity.queued = row.count
        else if (status === 'failed') emailActivity.failed = row.count
      }

      // Map log level breakdown
      const logLevelBreakdown = { error: 0, warn: 0, info: 0, debug: 0 }
      for (const row of logLevelsRaw || []) {
        const level = row.level as string
        if (level in logLevelBreakdown) {
          logLevelBreakdown[level as keyof typeof logLevelBreakdown] = row.count
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
        sqlNormalized: r.sql_normalized,
        avgDuration: r.avg_duration,
        count: r.count,
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

  /** Get sparkline data points from pre-aggregated metrics. */
  async getSparklineData(range: string): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    const cutoff = rangeToCutoff(range)
    const metrics: Record<string, unknown>[] = await this.db('server_stats_metrics')
      .where('created_at', '>=', cutoff)
      .orderBy('bucket', 'asc')

    return metrics.slice(-15)
  }

  // =========================================================================
  // Saved filters CRUD
  // =========================================================================

  async getSavedFilters(section?: string): Promise<Record<string, unknown>[]> {
    if (!this.db) return []

    const query = this.db('server_stats_saved_filters').orderBy('created_at', 'desc')
    if (section) query.where('section', section)
    return query
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

    const row = await this.db('server_stats_queries').where('id', queryId).first()
    if (!row) return { error: 'Query not found' }

    const sql = row.sql_text.trim()
    if (!sql.toLowerCase().startsWith('select')) {
      return { error: 'EXPLAIN is only supported for SELECT queries' }
    }

    try {
      const result = await (appDb as { rawQuery: (sql: string) => Promise<{ rows?: unknown[] }> }).rawQuery(`EXPLAIN ${sql}`)
      return { plan: result.rows || result }
    } catch (err) {
      return { error: (err as Error).message || 'EXPLAIN failed' }
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /** Generic paginated query with filter callback. */
  private async paginate(
    table: string,
    page: number,
    perPage: number,
    applyFilters?: (query: Knex.QueryBuilder) => void
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    if (!this.db) {
      return { data: [], total: 0, page, perPage, lastPage: 0 }
    }

    // Count total
    const countQuery = this.db(table)
    if (applyFilters) applyFilters(countQuery)
    const [{ count: total }] = await countQuery.count('* as count')

    // Fetch page
    const offset = (page - 1) * perPage
    const dataQuery = this.db(table).orderBy('created_at', 'desc').limit(perPage).offset(offset)
    if (applyFilters) applyFilters(dataQuery)
    const data = await dataQuery

    return {
      data,
      total,
      page,
      perPage,
      lastPage: Math.ceil(total / perPage),
    }
  }

  /**
   * Wire email event listeners to persist emails as they arrive.
   */
  private wireEventListeners(): void {
    if (!this.emitter || typeof this.emitter.on !== 'function') return

    const buildAndPersistEmail = (data: unknown, status: EmailRecord['status']) => {
      const d = data as Record<string, unknown> | undefined
      const msg = (d?.message || d) as Record<string, unknown> | undefined
      const record: EmailRecord = {
        id: 0,
        from: extractAddresses(msg?.from) || 'unknown',
        to: extractAddresses(msg?.to) || 'unknown',
        cc: extractAddresses(msg?.cc) || null,
        bcc: extractAddresses(msg?.bcc) || null,
        subject: (msg?.subject as string) || '(no subject)',
        html: (msg?.html as string) || null,
        text: (msg?.text as string) || null,
        mailer: (d?.mailerName as string) || (d?.mailer as string) || 'unknown',
        status,
        messageId: (d?.response as Record<string, unknown>)?.messageId as string || (d?.messageId as string) || null,
        attachmentCount: Array.isArray(msg?.attachments) ? (msg.attachments as unknown[]).length : 0,
        timestamp: Date.now(),
      }
      this.recordEmail(record)
    }

    this.handlers = [
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
