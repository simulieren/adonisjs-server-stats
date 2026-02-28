import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeParseJson, safeParseJsonArray } from '../utils/json_helpers.js'
import { log } from '../utils/logger.js'
import { round, clamp } from '../utils/math_helpers.js'
import { loadTransmitClient } from '../utils/transmit_client.js'
import { CacheInspector } from './integrations/cache_inspector.js'
import { ConfigInspector } from './integrations/config_inspector.js'
import { QueueInspector } from './integrations/queue_inspector.js'

import type { DebugStore } from '../debug/debug_store.js'
import type { DevToolbarOptions, ServerStatsConfig } from '../types.js'
import type { DashboardStore } from './dashboard_store.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'

/** Minimal interface for Edge.js view rendering on the HTTP context. */
interface EdgeViewContext {
  render(template: string, data: Record<string, unknown>): Promise<string>
}

const warnedDbReads = new Set<string>()

const SRC_DIR = dirname(fileURLToPath(import.meta.url))
const EDGE_DIR = join(SRC_DIR, '..', 'edge')
const STYLES_DIR = join(SRC_DIR, '..', 'styles')

interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    lastPage: number
  }
}

function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number
): PaginatedResponse<T> {
  return {
    data,
    meta: { total, page, perPage, lastPage: Math.max(1, Math.ceil(total / perPage)) },
  }
}

function emptyPage<T>(page: number, perPage: number): PaginatedResponse<T> {
  return { data: [], meta: { total: 0, page, perPage, lastPage: 1 } }
}

interface ChartBucket {
  bucket: string
  requestCount: number
  avgDuration: number
  p95Duration: number
  errorCount: number
  queryCount: number
}

/**
 * Controller for the full-page dashboard.
 *
 * Serves the dashboard HTML page and all JSON API endpoints.
 * Delegates all data access to the DashboardStore.
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

  async page(ctx: HttpContext) {
    if (!this.checkAccess(ctx)) {
      return ctx.response.forbidden({ error: 'Access denied' })
    }

    const config = this.app.config.get<ServerStatsConfig>('server_stats')
    const toolbarConfig: Partial<DevToolbarOptions> = config?.devToolbar ?? {}

    if (!this.cachedCss) {
      this.cachedCss = readFileSync(join(STYLES_DIR, 'dashboard.css'), 'utf-8')
    }
    if (!this.cachedJs) {
      const renderer = toolbarConfig.renderer || 'preact'
      const clientDir = renderer === 'vue' ? 'client-vue' : 'client'
      this.cachedJs = readFileSync(join(EDGE_DIR, clientDir, 'dashboard.js'), 'utf-8')
    }
    if (this.cachedTransmitClient === null) {
      this.cachedTransmitClient = loadTransmitClient(this.app.makePath('package.json'))
      if (this.cachedTransmitClient) {
        log.info('Transmit client loaded for dashboard')
      } else {
        log.info(
          'Dashboard will use polling. Install @adonisjs/transmit-client for real-time updates.'
        )
      }
    }
    const dashPath = this.getDashboardPath()

    return (ctx as unknown as { view: EdgeViewContext }).view.render('ss::dashboard', {
      css: this.cachedCss,
      js: this.cachedJs,
      transmitClient: this.cachedTransmitClient,
      dashConfig: {
        baseUrl: '',
        dashboardEndpoint: dashPath + '/api',
        debugEndpoint: toolbarConfig.debugEndpoint || '/admin/api/debug',
        channelName: 'server-stats/dashboard',
        backUrl: '/',
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  async overview({ request, response }: HttpContext) {
    return this.withDb(response, 'overview', emptyOverview(), async () => {
      const range = request.qs().range || '1h'

      const [overview, widgets, sparklineData] = await Promise.all([
        this.dashboardStore.getOverviewMetrics(range),
        this.dashboardStore.getOverviewWidgets(range),
        this.dashboardStore.getSparklineData(range),
      ])
      if (!overview) return emptyOverview()

      const [cacheStats, jobQueueStatus] = await Promise.all([
        this.fetchCacheOverview(),
        this.fetchQueueOverview(),
      ])

      return {
        ...overview,
        sparklines: {
          avgResponseTime: sparklineData.map((m: Record<string, unknown>) => m.avg_duration),
          p95ResponseTime: sparklineData.map((m: Record<string, unknown>) => m.p95_duration),
          requestsPerMinute: sparklineData.map((m: Record<string, unknown>) => m.request_count),
          errorRate: sparklineData.map((m: Record<string, unknown>) =>
            (m.request_count as number) > 0
              ? round(((m.error_count as number) / (m.request_count as number)) * 100)
              : 0
          ),
        },
        ...widgets,
        cacheStats,
        jobQueueStatus,
      }
    })
  }

  async overviewChart({ request, response }: HttpContext) {
    const range = request.qs().range || '1h'

    return this.withDb(
      response,
      'overviewChart',
      { range, buckets: [] as ChartBucket[] },
      async () => {
        const buckets = await this.dashboardStore.getChartData(range)

        return {
          range,
          buckets: buckets.map(
            (b: Record<string, unknown>): ChartBucket => ({
              bucket: b.bucket as string,
              requestCount: b.request_count as number,
              avgDuration: b.avg_duration as number,
              p95Duration: b.p95_duration as number,
              errorCount: b.error_count as number,
              queryCount: b.query_count as number,
            })
          ),
        }
      }
    )
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  async requests({ request, response }: HttpContext) {
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    return this.withDb(response, 'requests', emptyPage(page, perPage), async () => {
      const result = await this.dashboardStore.getRequests(page, perPage, {
        method: qs.method ? qs.method.toUpperCase() : undefined,
        url: qs.url || undefined,
        status: qs.status ? Number(qs.status) : undefined,
        search: qs.search || undefined,
      })

      return paginatedResponse(
        result.data.map(formatRequest),
        result.total,
        result.page,
        result.perPage
      )
    })
  }

  async requestDetail({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) {
      return response.notFound({ error: 'Not found' })
    }

    try {
      const detail = await this.dashboardStore.getRequestDetail(Number(params.id))
      if (!detail) return response.notFound({ error: 'Request not found' })

      return response.json({
        ...formatRequest(detail),
        queries: ((detail.queries as Record<string, unknown>[]) || []).map(formatQuery),
        trace: detail.trace ? formatTrace(detail.trace as Record<string, unknown>) : null,
      })
    } catch {
      return response.notFound({ error: 'Not found' })
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async queries({ request, response }: HttpContext) {
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    return this.withDb(response, 'queries', emptyPage(page, perPage), async () => {
      const result = await this.dashboardStore.getQueries(page, perPage, {
        durationMin: qs.duration_min ? Number(qs.duration_min) : undefined,
        model: qs.model || undefined,
        method: qs.method || undefined,
        connection: qs.connection || undefined,
        search: qs.search || undefined,
      })

      return paginatedResponse(
        result.data.map(formatQuery),
        result.total,
        result.page,
        result.perPage
      )
    })
  }

  async queriesGrouped({ request, response }: HttpContext) {
    return this.withDb(response, 'queriesGrouped', { groups: [] }, async () => {
      const qs = request.qs()
      const limit = clamp(Number(qs.limit) || 50, 1, 200)
      const sort = qs.sort || 'total_duration'

      const search = qs.search || undefined
      const groups = await this.dashboardStore.getQueriesGrouped(limit, sort, search)

      const totalTime = groups.reduce(
        (sum: number, g: Record<string, unknown>) => sum + ((g.total_duration as number) || 0),
        0
      )

      return {
        groups: groups.map((g: Record<string, unknown>) => ({
          sqlNormalized: g.sql_normalized,
          count: g.count,
          avgDuration: round(g.avg_duration as number),
          minDuration: round(g.min_duration as number),
          maxDuration: round(g.max_duration as number),
          totalDuration: round(g.total_duration as number),
          percentOfTotal:
            totalTime > 0 ? round(((g.total_duration as number) / totalTime) * 100) : 0,
        })),
      }
    })
  }

  async queryExplain({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) {
      return response.notFound({ error: 'Not found' })
    }

    try {
      const db = this.dashboardStore.getDb()
      if (!db) return response.notFound({ error: 'Not found' })
      const id = Number(params.id)
      const query: Record<string, unknown> | undefined = await db('server_stats_queries')
        .where('id', id)
        .first()
      if (!query) return response.notFound({ error: 'Query not found' })

      const sqlTrimmed = (query.sql_text as string).trim().toUpperCase()
      if (!sqlTrimmed.startsWith('SELECT')) {
        return response.badRequest({
          error: 'EXPLAIN is only supported for SELECT queries',
        })
      }

      let appDb: unknown
      try {
        const lucid: unknown = await this.app.container.make('lucid.db')
        appDb = (lucid as { connection: () => { getWriteClient: () => unknown } })
          .connection()
          .getWriteClient()
      } catch {
        return response.serviceUnavailable({
          error: 'App database connection not available',
        })
      }

      let bindings: unknown[] = []
      if (query.bindings) {
        try {
          bindings = JSON.parse(query.bindings as string)
        } catch {
          // If bindings can't be parsed, run without them
        }
      }

      const explainResult = await (
        appDb as { raw: (sql: string, bindings: unknown[]) => Promise<Record<string, unknown>> }
      ).raw(`EXPLAIN (FORMAT JSON) ${query.sql_text}`, bindings)

      let plan: unknown[] = []
      const rawRows =
        (explainResult?.rows as Record<string, unknown>[]) ??
        (Array.isArray(explainResult) ? explainResult : [])
      if (rawRows.length > 0 && rawRows[0]['QUERY PLAN']) {
        plan = rawRows[0]['QUERY PLAN'] as unknown[]
      } else {
        plan = rawRows
      }

      return response.json({ queryId: id, sql: query.sql_text, plan })
    } catch (error) {
      return response.internalServerError({
        error: 'EXPLAIN failed',
        message: (error as Error)?.message ?? 'Unknown error',
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  async events({ request, response }: HttpContext) {
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    return this.withDb(response, 'events', emptyPage(page, perPage), async () => {
      const result = await this.dashboardStore.getEvents(page, perPage, {
        eventName: qs.event_name || undefined,
        search: qs.search || undefined,
      })

      return paginatedResponse(
        result.data.map((e: Record<string, unknown>) => ({
          id: e.id,
          requestId: e.request_id,
          eventName: e.event_name,
          data: safeParseJson(e.data),
          createdAt: e.created_at,
        })),
        result.total,
        result.page,
        result.perPage
      )
    })
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  async routes({ request, response }: HttpContext) {
    const qs = request.qs()
    const search = (qs.search || '').toLowerCase()
    let routes = this.debugStore.routes.getRoutes()

    if (search) {
      routes = routes.filter((r) => {
        const pattern = (r.pattern || '').toLowerCase()
        const handler = (r.handler || '').toLowerCase()
        const name = (r.name || '').toLowerCase()
        const method = (r.method || '').toLowerCase()
        return (
          pattern.includes(search) ||
          handler.includes(search) ||
          name.includes(search) ||
          method.includes(search)
        )
      })
    }

    const total = routes.length
    return response.json({
      data: routes,
      meta: { total, page: 1, perPage: total || 1, lastPage: 1 },
    })
  }

  // ---------------------------------------------------------------------------
  // Logs
  // ---------------------------------------------------------------------------

  async logs({ request, response }: HttpContext) {
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 50, 1, 200)

    // Build structured filters from query string
    const structured: {
      field: string
      operator: 'equals' | 'contains' | 'startsWith'
      value: string
    }[] = []

    const operatorMap: Record<string, 'equals' | 'contains' | 'startsWith'> = {
      equals: 'equals',
      contains: 'contains',
      starts_with: 'startsWith',
    }

    // Support legacy single-filter format: field=, operator=, value=
    if (qs.field && qs.value !== undefined) {
      const op = qs.operator || 'equals'
      structured.push({
        field: qs.field,
        operator: operatorMap[op] || 'equals',
        value: qs.value,
      })
    }

    // Support indexed filter format: filter_field_0, filter_op_0, filter_value_0, ...
    for (let i = 0; i < 20; i++) {
      const field = qs[`filter_field_${i}`]
      const value = qs[`filter_value_${i}`]
      if (field && value !== undefined) {
        const op = qs[`filter_op_${i}`] || 'equals'
        structured.push({
          field,
          operator: operatorMap[op] || 'equals',
          value,
        })
      } else {
        break
      }
    }

    return this.withDb(response, 'logs', emptyPage(page, perPage), async () => {
      const result = await this.dashboardStore.getLogs(page, perPage, {
        level: qs.level || undefined,
        search: qs.message || qs.search || undefined,
        requestId: qs.request_id || qs.requestId || undefined,
        structured: structured.length > 0 ? structured : undefined,
      })

      return paginatedResponse(
        result.data.map((l: Record<string, unknown>) => ({
          id: l.id,
          level: l.level,
          message: l.message,
          requestId: l.request_id,
          data: safeParseJson(l.data),
          createdAt: l.created_at,
        })),
        result.total,
        result.page,
        result.perPage
      )
    })
  }

  // ---------------------------------------------------------------------------
  // Emails
  // ---------------------------------------------------------------------------

  async emails({ request, response }: HttpContext) {
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    return this.withDb(response, 'emails', emptyPage(page, perPage), async () => {
      const result = await this.dashboardStore.getEmails(
        page,
        perPage,
        {
          search: qs.search || undefined,
          from: qs.from || undefined,
          to: qs.to || undefined,
          subject: qs.subject || undefined,
          status: qs.status || undefined,
          mailer: qs.mailer || undefined,
        },
        true
      )

      return paginatedResponse(
        result.data.map(formatEmail),
        result.total,
        result.page,
        result.perPage
      )
    })
  }

  async emailPreview({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) {
      return response.notFound({ error: 'Not found' })
    }

    try {
      const html = await this.dashboardStore.getEmailHtml(Number(params.id))
      if (!html) return response.notFound({ error: 'Email not found' })

      return response.header('Content-Type', 'text/html; charset=utf-8').send(html)
    } catch {
      return response.notFound({ error: 'Not found' })
    }
  }

  // ---------------------------------------------------------------------------
  // Traces
  // ---------------------------------------------------------------------------

  async traces({ request, response }: HttpContext) {
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)

    return this.withDb(response, 'traces', emptyPage(page, perPage), async () => {
      const result = await this.dashboardStore.getTraces(page, perPage, {
        method: qs.method ? qs.method.toUpperCase() : undefined,
        url: qs.url || undefined,
        search: qs.search || undefined,
        statusMin: qs.status_min ? Number(qs.status_min) : undefined,
        statusMax: qs.status_max ? Number(qs.status_max) : undefined,
      })

      return paginatedResponse(
        result.data.map((t: Record<string, unknown>) => ({
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
        result.total,
        result.page,
        result.perPage
      )
    })
  }

  async traceDetail({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) {
      return response.notFound({ error: 'Not found' })
    }

    try {
      const trace = await this.dashboardStore.getTraceDetail(Number(params.id))
      if (!trace) return response.notFound({ error: 'Trace not found' })

      return response.json(formatTrace(trace))
    } catch {
      return response.notFound({ error: 'Not found' })
    }
  }

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  async cacheStats({ request, response }: HttpContext) {
    const inspector = await this.getInspector('cache')
    if (!inspector) {
      return response.json({ available: false, stats: null, keys: [] })
    }

    const qs = request.qs()
    const searchTerm = qs.search || qs.pattern || ''
    const pattern = searchTerm ? `*${searchTerm}*` : '*'
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

  async cacheKey({ params, response }: HttpContext) {
    const inspector = await this.getInspector('cache')
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

  async cacheKeyDelete({ params, response }: HttpContext) {
    const inspector = await this.getInspector('cache')
    if (!inspector) {
      return response.notFound({ error: 'Cache not available' })
    }

    try {
      const key = decodeURIComponent(params.key)
      const deleted = await inspector.deleteKey(key)
      if (!deleted) return response.notFound({ error: 'Key not found' })

      return response.json({ deleted: true })
    } catch {
      return response.internalServerError({ error: 'Failed to delete cache key' })
    }
  }

  // ---------------------------------------------------------------------------
  // Jobs / Queue
  // ---------------------------------------------------------------------------

  async jobs({ request, response }: HttpContext) {
    const inspector = await this.getInspector('queue')
    if (!inspector) {
      return response.json({
        available: false,
        overview: null,
        stats: null,
        jobs: [],
        total: 0,
      })
    }

    const qs = request.qs()
    const status = qs.status || 'all'
    const searchTerm = qs.search || ''
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || Number(qs.limit) || 25, 1, 100)

    try {
      const [overview, jobList] = await Promise.all([
        inspector.getOverview(),
        inspector.listJobs(status, page, perPage),
      ])

      // Filter jobs by search term (name match) if provided
      let filteredJobs = jobList.jobs
      let filteredTotal = jobList.total
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        filteredJobs = jobList.jobs.filter(
          (j) =>
            j.name?.toLowerCase().includes(term) ||
            j.id?.toString().toLowerCase().includes(term)
        )
        filteredTotal = filteredJobs.length
      }

      return response.json({
        available: true,
        overview,
        stats: overview,
        jobs: filteredJobs,
        total: filteredTotal,
        page,
        perPage,
      })
    } catch {
      return response.json({
        available: false,
        overview: null,
        stats: null,
        jobs: [],
        total: 0,
      })
    }
  }

  async jobDetail({ params, response }: HttpContext) {
    const inspector = await this.getInspector('queue')
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

  async jobRetry({ params, response }: HttpContext) {
    const inspector = await this.getInspector('queue')
    if (!inspector) {
      return response.notFound({ error: 'Queue not available' })
    }

    try {
      const success = await inspector.retryJob(String(params.id))
      if (!success) {
        return response.badRequest({
          error: 'Job could not be retried (not in failed state)',
        })
      }
      return response.json({ success: true })
    } catch {
      return response.internalServerError({ error: 'Retry failed' })
    }
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  async config({ response }: HttpContext) {
    const configData = this.configInspector.getConfig()
    const envData = this.configInspector.getEnvVars()

    return response.json({
      app: configData.config,
      env: envData.env,
    })
  }

  // ---------------------------------------------------------------------------
  // Saved Filters
  // ---------------------------------------------------------------------------

  async savedFilters({ response }: HttpContext) {
    return this.withDb(response, 'savedFilters', { filters: [] }, async () => {
      const filters = await this.dashboardStore.getSavedFilters()
      return {
        filters: filters.map((f: Record<string, unknown>) => ({
          id: f.id,
          name: f.name,
          section: f.section,
          filterConfig: safeParseJson(f.filter_config),
          createdAt: f.created_at,
        })),
      }
    })
  }

  async createSavedFilter({ request, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) {
      return response.serviceUnavailable({ error: 'Database not available' })
    }

    try {
      const body = request.body()
      const { name, section, filterConfig } = body

      if (!name || !section || !filterConfig) {
        return response.badRequest({
          error: 'Missing required fields: name, section, filterConfig',
        })
      }

      const configObj =
        typeof filterConfig === 'string' ? safeParseJson(filterConfig) : filterConfig
      const result = await this.dashboardStore.createSavedFilter(name, section, configObj)
      if (!result) {
        return response.serviceUnavailable({ error: 'Database not available' })
      }

      return response.json(result)
    } catch {
      return response.internalServerError({ error: 'Failed to create filter' })
    }
  }

  async deleteSavedFilter({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) {
      return response.serviceUnavailable({ error: 'Database not available' })
    }

    try {
      const deleted = await this.dashboardStore.deleteSavedFilter(Number(params.id))
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
   * Wraps a store call with null-guard + try/catch boilerplate.
   * Returns emptyValue if the store is not ready or the fn throws.
   */
  private async withDb<T>(
    response: HttpContext['response'],
    label: string,
    emptyValue: T,
    fn: () => Promise<T>
  ) {
    if (!this.dashboardStore.isReady()) return response.json(emptyValue)

    try {
      return response.json(await fn())
    } catch (err) {
      if (!warnedDbReads.has(label)) {
        warnedDbReads.add(label)
        log.warn(`dashboard ${label}: DB read failed — ${(err as Error)?.message}`)
      }
      return response.json(emptyValue)
    }
  }

  private checkAccess(ctx: HttpContext): boolean {
    const config = this.app.config.get<ServerStatsConfig>('server_stats')
    if (!config?.shouldShow) return true

    try {
      return config.shouldShow(ctx)
    } catch {
      return false
    }
  }

  private getDashboardPath(): string {
    const config = this.app.config.get<ServerStatsConfig>('server_stats')
    return config?.devToolbar?.dashboardPath ?? '/__stats'
  }

  /** Lazy-init inspector pattern for cache and queue. */
  private async getInspector(type: 'cache'): Promise<CacheInspector | null>
  private async getInspector(type: 'queue'): Promise<QueueInspector | null>
  private async getInspector(
    type: 'cache' | 'queue'
  ): Promise<CacheInspector | QueueInspector | null> {
    if (type === 'cache') {
      if (this.cacheAvailable === false) return null
      if (this.cacheInspector) return this.cacheInspector

      try {
        const available = await CacheInspector.isAvailable(this.app)
        this.cacheAvailable = available
        if (!available) {
          log.info('dashboard: Redis not detected — Cache panel disabled')
          return null
        }

        const redis = await this.app.container.make('redis')
        this.cacheInspector = new CacheInspector(redis)
        return this.cacheInspector
      } catch (err) {
        this.cacheAvailable = false
        log.warn('dashboard: CacheInspector init failed — ' + (err as Error)?.message)
        return null
      }
    } else {
      if (this.queueAvailable === false) return null
      if (this.queueInspector) return this.queueInspector

      try {
        const available = await QueueInspector.isAvailable(this.app)
        this.queueAvailable = available
        if (!available) {
          log.info('dashboard: Queue not detected — Jobs panel disabled')
          return null
        }

        const queue = await this.app.container.make('rlanz/queue')
        this.queueInspector = new QueueInspector(queue)
        return this.queueInspector
      } catch (err) {
        this.queueAvailable = false
        log.warn('dashboard: QueueInspector init failed — ' + (err as Error)?.message)
        return null
      }
    }
  }

  /** Fetch cache overview stats for the overview page. */
  private async fetchCacheOverview() {
    try {
      const inspector = await this.getInspector('cache')
      if (!inspector) return null

      const stats = await inspector.getStats()
      return {
        available: true,
        totalKeys: stats.totalKeys,
        hitRate: stats.hitRate,
        memoryUsedHuman: stats.memoryUsedHuman,
      }
    } catch {
      return null
    }
  }

  /** Fetch queue overview stats for the overview page. */
  private async fetchQueueOverview() {
    try {
      const inspector = await this.getInspector('queue')
      if (!inspector) return null

      const overview = await inspector.getOverview()
      return {
        available: true,
        active: overview.active,
        waiting: overview.waiting,
        failed: overview.failed,
        completed: overview.completed,
      }
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers (snake_case DB rows → camelCase API response)
// ---------------------------------------------------------------------------

function formatRequest(r: Record<string, unknown>) {
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

function formatQuery(q: Record<string, unknown>) {
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

function formatTrace(t: Record<string, unknown>) {
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

function formatEmail(e: Record<string, unknown>) {
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
