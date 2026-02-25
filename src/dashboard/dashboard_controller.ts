import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'
import type { DashboardStore } from './dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import { CacheInspector } from './integrations/cache_inspector.js'
import { QueueInspector } from './integrations/queue_inspector.js'
import { ConfigInspector } from './integrations/config_inspector.js'

const EDGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'edge')

/**
 * Controller for the full-page dashboard.
 *
 * Serves the dashboard HTML page and all JSON API endpoints.
 * Constructor-injected with the SQLite-backed DashboardStore,
 * the in-memory DebugStore, and the AdonisJS application instance.
 */
export default class DashboardController {
  private cacheInspector: CacheInspector | null = null
  private queueInspector: QueueInspector | null = null
  private configInspector: ConfigInspector
  private cacheAvailable: boolean | null = null
  private queueAvailable: boolean | null = null
  private cachedCss: string | null = null
  private cachedJs: string | null = null
  private cachedTransmitClient: string | null = null

  constructor(
    private dashboardStore: DashboardStore,
    private debugStore: DebugStore,
    private app: ApplicationService
  ) {
    this.configInspector = new ConfigInspector(app)
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath} — Render the dashboard Edge template.
   *
   * Reads the dashboard CSS/JS assets and passes them as template state
   * along with configuration for tracing and custom panes.
   */
  async page(ctx: HttpContext) {
    if (!this.checkAccess(ctx)) {
      return ctx.response.forbidden({ error: 'Access denied' })
    }

    // Lazily read and cache the CSS/JS assets
    if (!this.cachedCss) {
      this.cachedCss = readFileSync(join(EDGE_DIR, 'client', 'dashboard.css'), 'utf-8')
    }
    if (!this.cachedJs) {
      this.cachedJs = readFileSync(join(EDGE_DIR, 'client', 'dashboard.js'), 'utf-8')
    }
    if (this.cachedTransmitClient === null) {
      this.cachedTransmitClient = this.loadTransmitClient()
    }

    const config = this.app.config.get<any>('server_stats')
    const toolbarConfig = config?.devToolbar || {}
    const dashPath = this.getDashboardPath()

    return (ctx as any).view.render('ss::dashboard', {
      css: this.cachedCss,
      js: this.cachedJs,
      transmitClient: this.cachedTransmitClient,
      dashboardPath: dashPath,
      showTracing: !!toolbarConfig.tracing,
      customPanes: toolbarConfig.panes || [],
      dashConfig: {
        basePath: dashPath,
        tracing: !!toolbarConfig.tracing,
        panes: (toolbarConfig.panes || []).map((p: any) => ({
          id: p.id,
          label: p.label,
        })),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/overview — Overview metrics cards.
   */
  async overview({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json(emptyOverview())

    try {
      const range = request.qs().range || '1h'

      // Use getOverviewMetrics for accurate stats (computed from raw requests)
      const [overview, widgets] = await Promise.all([
        this.dashboardStore.getOverviewMetrics(range),
        this.dashboardStore.getOverviewWidgets(range),
      ])
      if (!overview) return response.json(emptyOverview())

      // Add sparklines from the pre-aggregated metrics table
      const cutoff = minutesAgo(60)
      const metrics: any[] = await db('server_stats_metrics')
        .where('created_at', '>=', cutoff)
        .orderBy('bucket', 'asc')

      const sparklineData = metrics.slice(-15)

      // Fetch cache and queue stats (non-blocking — null if unavailable)
      let cacheStats: { available: boolean; totalKeys: number; hitRate: number; memoryUsedHuman: string } | null = null
      let jobQueueStatus: { available: boolean; active: number; waiting: number; failed: number; completed: number } | null = null

      try {
        const cacheInspector = await this.getCacheInspector()
        if (cacheInspector) {
          const stats = await cacheInspector.getStats()
          cacheStats = {
            available: true,
            totalKeys: stats.totalKeys,
            hitRate: stats.hitRate,
            memoryUsedHuman: stats.memoryUsedHuman,
          }
        }
      } catch {
        // Cache not available
      }

      try {
        const queueInspector = await this.getQueueInspector()
        if (queueInspector) {
          const qOverview = await queueInspector.getOverview()
          jobQueueStatus = {
            available: true,
            active: qOverview.active,
            waiting: qOverview.waiting,
            failed: qOverview.failed,
            completed: qOverview.completed,
          }
        }
      } catch {
        // Queue not available
      }

      return response.json({
        ...overview,
        sparklines: {
          avgResponseTime: sparklineData.map((m: any) => m.avg_duration),
          p95ResponseTime: sparklineData.map((m: any) => m.p95_duration),
          requestsPerMinute: sparklineData.map((m: any) => m.request_count),
          errorRate: sparklineData.map((m: any) =>
            m.request_count > 0 ? round((m.error_count / m.request_count) * 100) : 0
          ),
        },
        ...widgets,
        cacheStats,
        jobQueueStatus,
      })
    } catch {
      return response.json(emptyOverview())
    }
  }

  /**
   * GET {dashboardPath}/api/overview/chart — Chart data with time range.
   */
  async overviewChart({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ buckets: [] })

    const range = request.qs().range || '1h'
    const { cutoff } = parseRange(range)

    try {
      const buckets: any[] = await db('server_stats_metrics')
        .where('bucket', '>=', cutoff)
        .orderBy('bucket', 'asc')

      return response.json({
        range,
        buckets: buckets.map((b: any) => ({
          bucket: b.bucket,
          requestCount: b.request_count,
          avgDuration: b.avg_duration,
          p95Duration: b.p95_duration,
          errorCount: b.error_count,
          queryCount: b.query_count,
        })),
      })
    } catch {
      return response.json({ buckets: [] })
    }
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/requests — Paginated request history.
   */
  async requests({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ data: [], total: 0 })

    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    try {
      let query = db('server_stats_requests')

      if (qs.method) query = query.where('method', qs.method.toUpperCase())
      if (qs.status) query = query.where('status_code', Number(qs.status))
      if (qs.url) query = query.where('url', 'like', `%${qs.url}%`)

      const countResult: any = await query.clone().count('* as total').first()
      const total = countResult?.total ?? 0

      const data: any[] = await query
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset((page - 1) * perPage)

      return response.json({
        data: data.map(formatRequest),
        total,
        page,
        perPage,
      })
    } catch {
      return response.json({ data: [], total: 0 })
    }
  }

  /**
   * GET {dashboardPath}/api/requests/:id — Single request with trace.
   */
  async requestDetail({ params, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.notFound({ error: 'Not found' })

    try {
      const id = Number(params.id)
      const req: any = await db('server_stats_requests').where('id', id).first()
      if (!req) return response.notFound({ error: 'Request not found' })

      const [queries, trace]: [any[], any] = await Promise.all([
        db('server_stats_queries').where('request_id', id).orderBy('created_at', 'asc'),
        db('server_stats_traces').where('request_id', id).first(),
      ])

      return response.json({
        ...formatRequest(req),
        queries: queries.map(formatQuery),
        trace: trace ? formatTrace(trace) : null,
      })
    } catch {
      return response.notFound({ error: 'Not found' })
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/queries — Paginated query history.
   */
  async queries({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ data: [], total: 0 })

    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    try {
      let query = db('server_stats_queries')

      if (qs.duration_min) query = query.where('duration', '>=', Number(qs.duration_min))
      if (qs.model) query = query.where('model', qs.model)
      if (qs.method) query = query.where('method', qs.method)
      if (qs.connection) query = query.where('connection', qs.connection)

      const countResult: any = await query.clone().count('* as total').first()
      const total = countResult?.total ?? 0

      const data: any[] = await query
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset((page - 1) * perPage)

      return response.json({
        data: data.map(formatQuery),
        total,
        page,
        perPage,
      })
    } catch {
      return response.json({ data: [], total: 0 })
    }
  }

  /**
   * GET {dashboardPath}/api/queries/grouped — Grouped by normalized SQL.
   */
  async queriesGrouped({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ groups: [] })

    const qs = request.qs()
    const limit = clamp(Number(qs.limit) || 50, 1, 200)
    const sort = qs.sort || 'total_duration'

    try {
      const validSorts: Record<string, string> = {
        count: 'count',
        avg_duration: 'avg_duration',
        total_duration: 'total_duration',
      }
      const orderCol = validSorts[sort] || 'total_duration'

      const groups: any[] = await db('server_stats_queries')
        .select('sql_normalized')
        .select(db.raw('COUNT(*) as count'))
        .select(db.raw('AVG(duration) as avg_duration'))
        .select(db.raw('MIN(duration) as min_duration'))
        .select(db.raw('MAX(duration) as max_duration'))
        .select(db.raw('SUM(duration) as total_duration'))
        .groupBy('sql_normalized')
        .orderBy(orderCol, 'desc')
        .limit(limit)

      // Calculate total time for percentage
      const totalTime = groups.reduce((sum: number, g: any) => sum + (g.total_duration || 0), 0)

      return response.json({
        groups: groups.map((g: any) => ({
          sqlNormalized: g.sql_normalized,
          count: g.count,
          avgDuration: round(g.avg_duration),
          minDuration: round(g.min_duration),
          maxDuration: round(g.max_duration),
          totalDuration: round(g.total_duration),
          percentOfTotal: totalTime > 0 ? round((g.total_duration / totalTime) * 100) : 0,
        })),
      })
    } catch {
      return response.json({ groups: [] })
    }
  }

  /**
   * GET {dashboardPath}/api/queries/:id/explain — Run EXPLAIN on a query.
   */
  async queryExplain({ params, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.notFound({ error: 'Not found' })

    try {
      const id = Number(params.id)
      const query: any = await db('server_stats_queries').where('id', id).first()
      if (!query) return response.notFound({ error: 'Query not found' })

      // Only allow EXPLAIN on SELECT queries
      const sqlTrimmed = query.sql_text.trim().toUpperCase()
      if (!sqlTrimmed.startsWith('SELECT')) {
        return response.badRequest({ error: 'EXPLAIN is only supported for SELECT queries' })
      }

      // Run EXPLAIN on the app's default database connection (not the stats connection)
      let appDb: any
      try {
        const lucid: any = await this.app.container.make('lucid.db')
        appDb = lucid.connection().getWriteClient()
      } catch {
        return response.serviceUnavailable({ error: 'App database connection not available' })
      }

      // Parse stored bindings and pass them to the EXPLAIN query
      let bindings: any[] = []
      if (query.bindings) {
        try {
          bindings = JSON.parse(query.bindings)
        } catch {
          // If bindings can't be parsed, run without them
        }
      }

      const explainResult = await appDb.raw(`EXPLAIN (FORMAT JSON) ${query.sql_text}`, bindings)

      // PostgreSQL with Knex: result is { rows: [...] }
      // Each row has a "QUERY PLAN" key containing the JSON plan
      let plan: any[] = []
      const rawRows = explainResult?.rows ?? (Array.isArray(explainResult) ? explainResult : [])
      if (rawRows.length > 0 && rawRows[0]['QUERY PLAN']) {
        // EXPLAIN (FORMAT JSON) returns a single row with a JSON array
        plan = rawRows[0]['QUERY PLAN']
      } else {
        plan = rawRows
      }

      return response.json({
        queryId: id,
        sql: query.sql_text,
        plan,
      })
    } catch (error: any) {
      return response.internalServerError({
        error: 'EXPLAIN failed',
        message: error?.message ?? 'Unknown error',
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/events — Paginated event history.
   */
  async events({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ data: [], total: 0 })

    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    try {
      let query = db('server_stats_events')

      if (qs.event_name) query = query.where('event_name', qs.event_name)

      const countResult: any = await query.clone().count('* as total').first()
      const total = countResult?.total ?? 0

      const data: any[] = await query
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset((page - 1) * perPage)

      return response.json({
        data: data.map((e: any) => ({
          id: e.id,
          requestId: e.request_id,
          eventName: e.event_name,
          data: safeParseJson(e.data),
          createdAt: e.created_at,
        })),
        total,
        page,
        perPage,
      })
    } catch {
      return response.json({ data: [], total: 0 })
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/routes — Route table (delegates to DebugStore).
   */
  async routes({ response }: HttpContext) {
    const routes = this.debugStore.routes.getRoutes()
    return response.json({
      routes,
      total: this.debugStore.routes.getRouteCount(),
    })
  }

  // ---------------------------------------------------------------------------
  // Logs
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/logs — Paginated logs with structured search.
   */
  async logs({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ data: [], total: 0 })

    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 50, 1, 200)

    try {
      let query = db('server_stats_logs')

      if (qs.level) query = query.where('level', qs.level)
      if (qs.message) query = query.where('message', 'like', `%${qs.message}%`)
      if (qs.request_id) query = query.where('request_id', qs.request_id)

      // Structured JSON field search: ?field=userId&operator=equals&value=5
      if (qs.field && qs.value !== undefined) {
        const operator = qs.operator || 'equals'
        const jsonPath = `$.${qs.field}`

        if (operator === 'equals') {
          query = query.whereRaw(`json_extract(data, ?) = ?`, [jsonPath, qs.value])
        } else if (operator === 'contains') {
          query = query.whereRaw(`json_extract(data, ?) LIKE ?`, [jsonPath, `%${qs.value}%`])
        } else if (operator === 'starts_with') {
          query = query.whereRaw(`json_extract(data, ?) LIKE ?`, [jsonPath, `${qs.value}%`])
        }
      }

      const countResult: any = await query.clone().count('* as total').first()
      const total = countResult?.total ?? 0

      const data: any[] = await query
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset((page - 1) * perPage)

      return response.json({
        data: data.map((l: any) => ({
          id: l.id,
          level: l.level,
          message: l.message,
          requestId: l.request_id,
          data: safeParseJson(l.data),
          createdAt: l.created_at,
        })),
        total,
        page,
        perPage,
      })
    } catch {
      return response.json({ data: [], total: 0 })
    }
  }

  // ---------------------------------------------------------------------------
  // Emails
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/emails — Paginated email history.
   */
  async emails({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ data: [], total: 0 })

    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    try {
      let query = db('server_stats_emails')

      if (qs.from) query = query.where('from_addr', 'like', `%${qs.from}%`)
      if (qs.to) query = query.where('to_addr', 'like', `%${qs.to}%`)
      if (qs.subject) query = query.where('subject', 'like', `%${qs.subject}%`)
      if (qs.status) query = query.where('status', qs.status)
      if (qs.mailer) query = query.where('mailer', qs.mailer)

      const countResult: any = await query.clone().count('* as total').first()
      const total = countResult?.total ?? 0

      // Strip html/text from list for performance
      const data: any[] = await query
        .select(
          'id', 'from_addr', 'to_addr', 'cc', 'bcc', 'subject',
          'mailer', 'status', 'message_id', 'attachment_count', 'created_at'
        )
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset((page - 1) * perPage)

      return response.json({
        data: data.map(formatEmail),
        total,
        page,
        perPage,
      })
    } catch {
      return response.json({ data: [], total: 0 })
    }
  }

  /**
   * GET {dashboardPath}/api/emails/:id/preview — Email HTML preview.
   */
  async emailPreview({ params, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.notFound({ error: 'Not found' })

    try {
      const id = Number(params.id)
      const email: any = await db('server_stats_emails')
        .where('id', id)
        .select('html', 'text_body')
        .first()

      if (!email) return response.notFound({ error: 'Email not found' })

      const html = email.html || email.text_body || '<p>No content</p>'
      return response.header('Content-Type', 'text/html; charset=utf-8').send(html)
    } catch {
      return response.notFound({ error: 'Not found' })
    }
  }

  // ---------------------------------------------------------------------------
  // Traces
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/traces — Paginated trace list (lightweight).
   */
  async traces({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ data: [], total: 0 })

    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    try {
      const countResult: any = await db('server_stats_traces').count('* as total').first()
      const total = countResult?.total ?? 0

      // Strip spans and warnings from list for performance
      const data: any[] = await db('server_stats_traces')
        .select(
          'id', 'request_id', 'method', 'url', 'status_code',
          'total_duration', 'span_count', 'warnings', 'created_at'
        )
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset((page - 1) * perPage)

      return response.json({
        data: data.map((t: any) => ({
          id: t.id,
          requestId: t.request_id,
          method: t.method,
          url: t.url,
          statusCode: t.status_code,
          totalDuration: t.total_duration,
          spanCount: t.span_count,
          warningCount: safeParseJsonArray(t.warnings).length,
          createdAt: t.created_at,
        })),
        total,
        page,
        perPage,
      })
    } catch {
      return response.json({ data: [], total: 0 })
    }
  }

  /**
   * GET {dashboardPath}/api/traces/:id — Single trace with full spans.
   */
  async traceDetail({ params, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.notFound({ error: 'Not found' })

    try {
      const id = Number(params.id)
      const trace: any = await db('server_stats_traces').where('id', id).first()
      if (!trace) return response.notFound({ error: 'Trace not found' })

      return response.json(formatTrace(trace))
    } catch {
      return response.notFound({ error: 'Not found' })
    }
  }

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/cache — Cache stats and key list.
   */
  async cacheStats({ request, response }: HttpContext) {
    const inspector = await this.getCacheInspector()
    if (!inspector) {
      return response.json({ available: false, stats: null, keys: [] })
    }

    const qs = request.qs()
    const pattern = qs.pattern || '*'
    const cursor = qs.cursor || '0'
    const count = clamp(Number(qs.count) || 100, 1, 500)

    try {
      const [stats, keyList] = await Promise.all([
        inspector.getStats(),
        inspector.listKeys(pattern, cursor, count),
      ])

      return response.json({
        available: true,
        stats,
        keys: keyList.keys,
        cursor: keyList.cursor,
      })
    } catch {
      return response.json({ available: false, stats: null, keys: [] })
    }
  }

  /**
   * GET {dashboardPath}/api/cache/:key — Single cache key detail.
   */
  async cacheKey({ params, response }: HttpContext) {
    const inspector = await this.getCacheInspector()
    if (!inspector) {
      return response.notFound({ error: 'Cache not available' })
    }

    try {
      const key = decodeURIComponent(params.key)
      const detail = await inspector.getKey(key)
      if (!detail) return response.notFound({ error: 'Key not found' })

      return response.json(detail)
    } catch {
      return response.notFound({ error: 'Key not found' })
    }
  }

  // ---------------------------------------------------------------------------
  // Jobs / Queue
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/jobs — Job list with status filter.
   */
  async jobs({ request, response }: HttpContext) {
    const inspector = await this.getQueueInspector()
    if (!inspector) {
      return response.json({ available: false, overview: null, jobs: [], total: 0 })
    }

    const qs = request.qs()
    const status = qs.status || 'active'
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    try {
      const [overview, jobList] = await Promise.all([
        inspector.getOverview(),
        inspector.listJobs(status, page, perPage),
      ])

      return response.json({
        available: true,
        overview,
        jobs: jobList.jobs,
        total: jobList.total,
        page,
        perPage,
      })
    } catch {
      return response.json({ available: false, overview: null, jobs: [], total: 0 })
    }
  }

  /**
   * GET {dashboardPath}/api/jobs/:id — Single job detail.
   */
  async jobDetail({ params, response }: HttpContext) {
    const inspector = await this.getQueueInspector()
    if (!inspector) {
      return response.notFound({ error: 'Queue not available' })
    }

    try {
      const detail = await inspector.getJob(String(params.id))
      if (!detail) return response.notFound({ error: 'Job not found' })

      return response.json(detail)
    } catch {
      return response.notFound({ error: 'Job not found' })
    }
  }

  /**
   * POST {dashboardPath}/api/jobs/:id/retry — Retry a failed job.
   */
  async jobRetry({ params, response }: HttpContext) {
    const inspector = await this.getQueueInspector()
    if (!inspector) {
      return response.notFound({ error: 'Queue not available' })
    }

    try {
      const success = await inspector.retryJob(String(params.id))
      if (!success) {
        return response.badRequest({ error: 'Job could not be retried (not in failed state)' })
      }
      return response.json({ success: true })
    } catch {
      return response.internalServerError({ error: 'Retry failed' })
    }
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/config — Sanitized app config and env vars.
   */
  async config({ response }: HttpContext) {
    const configData = this.configInspector.getConfig()
    const envData = this.configInspector.getEnvVars()

    return response.json({
      config: configData.config,
      env: envData.env,
    })
  }

  // ---------------------------------------------------------------------------
  // Saved Filters
  // ---------------------------------------------------------------------------

  /**
   * GET {dashboardPath}/api/filters — List saved filter presets.
   */
  async savedFilters({ response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.json({ filters: [] })

    try {
      const filters: any[] = await db('server_stats_saved_filters')
        .orderBy('created_at', 'desc')

      return response.json({
        filters: filters.map((f: any) => ({
          id: f.id,
          name: f.name,
          section: f.section,
          filterConfig: safeParseJson(f.filter_config),
          createdAt: f.created_at,
        })),
      })
    } catch {
      return response.json({ filters: [] })
    }
  }

  /**
   * POST {dashboardPath}/api/filters — Create a saved filter preset.
   */
  async createSavedFilter({ request, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.serviceUnavailable({ error: 'Database not available' })

    try {
      const body = request.body()
      const name = body.name
      const section = body.section
      const filterConfig = body.filterConfig

      if (!name || !section || !filterConfig) {
        return response.badRequest({ error: 'Missing required fields: name, section, filterConfig' })
      }

      const [id] = await db('server_stats_saved_filters').insert({
        name,
        section,
        filter_config: typeof filterConfig === 'string' ? filterConfig : JSON.stringify(filterConfig),
      })

      return response.json({
        id,
        name,
        section,
        filterConfig: typeof filterConfig === 'string' ? safeParseJson(filterConfig) : filterConfig,
      })
    } catch {
      return response.internalServerError({ error: 'Failed to create filter' })
    }
  }

  /**
   * DELETE {dashboardPath}/api/filters/:id — Delete a saved filter preset.
   */
  async deleteSavedFilter({ params, response }: HttpContext) {
    const db = this.dashboardStore.getDb()
    if (!db) return response.serviceUnavailable({ error: 'Database not available' })

    try {
      const id = Number(params.id)
      const deleted = await db('server_stats_saved_filters').where('id', id).del()

      if (!deleted) return response.notFound({ error: 'Filter not found' })
      return response.json({ success: true })
    } catch {
      return response.internalServerError({ error: 'Failed to delete filter' })
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if the current request is authorized via shouldShow.
   */
  private checkAccess(ctx: HttpContext): boolean {
    const config = this.app.config.get<any>('server_stats')
    if (!config?.shouldShow) return true

    try {
      return config.shouldShow(ctx)
    } catch {
      return false
    }
  }

  /**
   * Get the configured dashboard path.
   */
  private getDashboardPath(): string {
    const config = this.app.config.get<any>('server_stats')
    return config?.devToolbar?.dashboardPath ?? '/__stats'
  }

  /**
   * Try to locate and read the @adonisjs/transmit-client build file.
   * Returns the file contents wrapped to expose `window.Transmit`, or
   * an empty string if the package is not installed.
   */
  private loadTransmitClient(): string {
    try {
      const req = createRequire(this.app.makePath('package.json'))
      const clientPath = req.resolve('@adonisjs/transmit-client/build/index.js')
      const src = readFileSync(clientPath, 'utf-8')
      console.log('[server-stats] Transmit client loaded from:', clientPath, `(${src.length} bytes)`)
      // The file is ESM with `export { Transmit }`. Wrap it in an IIFE
      // that captures the export and assigns it to window.Transmit.
      return `(function(){var __exports={};(function(){${
        src.replace(/^export\s*\{[^}]*\}\s*;?\s*$/m, '')
      }\n__exports.Transmit=Transmit;})();window.Transmit=__exports.Transmit;})()`
    } catch (err: any) {
      console.log('[server-stats] Transmit client not available:', err?.message || 'unknown error')
      console.log('[server-stats] Dashboard will use polling. Install @adonisjs/transmit-client for real-time updates.')
      return ''
    }
  }

  /**
   * Lazily initialize and return the CacheInspector (if Redis is available).
   */
  private async getCacheInspector(): Promise<CacheInspector | null> {
    if (this.cacheAvailable === false) return null

    if (this.cacheInspector) return this.cacheInspector

    try {
      const available = await CacheInspector.isAvailable(this.app)
      this.cacheAvailable = available
      if (!available) return null

      const redis = await this.app.container.make('redis')
      this.cacheInspector = new CacheInspector(redis)
      return this.cacheInspector
    } catch {
      this.cacheAvailable = false
      return null
    }
  }

  /**
   * Lazily initialize and return the QueueInspector (if Bull Queue is available).
   */
  private async getQueueInspector(): Promise<QueueInspector | null> {
    if (this.queueAvailable === false) return null

    if (this.queueInspector) return this.queueInspector

    try {
      const available = await QueueInspector.isAvailable(this.app)
      this.queueAvailable = available
      if (!available) return null

      const queue = await this.app.container.make('queue')
      this.queueInspector = new QueueInspector(queue)
      return this.queueInspector
    } catch {
      this.queueAvailable = false
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatRequest(r: any) {
  return {
    id: r.id,
    method: r.method,
    url: r.url,
    statusCode: r.status_code,
    duration: r.duration,
    spanCount: r.span_count,
    warningCount: r.warning_count,
    createdAt: r.created_at,
  }
}

function formatQuery(q: any) {
  return {
    id: q.id,
    requestId: q.request_id,
    sql: q.sql_text,
    sqlNormalized: q.sql_normalized,
    bindings: safeParseJson(q.bindings),
    duration: q.duration,
    method: q.method,
    model: q.model,
    connection: q.connection,
    inTransaction: !!q.in_transaction,
    createdAt: q.created_at,
  }
}

function formatTrace(t: any) {
  return {
    id: t.id,
    requestId: t.request_id,
    method: t.method,
    url: t.url,
    statusCode: t.status_code,
    totalDuration: t.total_duration,
    spanCount: t.span_count,
    spans: safeParseJson(t.spans) ?? [],
    warnings: safeParseJsonArray(t.warnings),
    createdAt: t.created_at,
  }
}

function formatEmail(e: any) {
  return {
    id: e.id,
    from: e.from_addr,
    to: e.to_addr,
    cc: e.cc,
    bcc: e.bcc,
    subject: e.subject,
    mailer: e.mailer,
    status: e.status,
    messageId: e.message_id,
    attachmentCount: e.attachment_count,
    createdAt: e.created_at,
  }
}

function emptyOverview() {
  return {
    avgResponseTime: 0,
    p95ResponseTime: 0,
    requestsPerMinute: 0,
    errorRate: 0,
    sparklines: {
      avgResponseTime: [],
      p95ResponseTime: [],
      requestsPerMinute: [],
      errorRate: [],
    },
    slowestEndpoints: [],
    queryStats: { total: 0, avgDuration: 0, perRequest: 0 },
    recentErrors: [],
    topEvents: [],
    emailActivity: { sent: 0, queued: 0, failed: 0 },
    logLevelBreakdown: { error: 0, warn: 0, info: 0, debug: 0 },
    statusDistribution: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    slowestQueries: [],
    cacheStats: null,
    jobQueueStatus: null,
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function minutesAgo(minutes: number): string {
  const d = new Date(Date.now() - minutes * 60_000)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

function parseRange(range: string): { cutoff: string } {
  const rangeMap: Record<string, number> = {
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '6h': 360,
    '24h': 1440,
    '7d': 10080,
  }
  const minutes = rangeMap[range] ?? 60
  return { cutoff: minutesAgo(minutes) }
}

function safeParseJson(value: any): any {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function safeParseJsonArray(value: any): any[] {
  const parsed = safeParseJson(value)
  return Array.isArray(parsed) ? parsed : []
}
