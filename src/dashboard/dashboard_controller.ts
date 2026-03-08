import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeParseJson } from '../utils/json_helpers.js'
import { log } from '../utils/logger.js'
import { clamp } from '../utils/math_helpers.js'
import { loadTransmitClient } from '../utils/transmit_client.js'
import { paginatedResponse, emptyPage, emptyOverview, formatRequest, formatQuery, formatTrace, formatLog, mapChartBucket, buildSparklines, formatGroupedQuery, runExplain } from './format_helpers.js'
import { CacheInspector } from './integrations/cache_inspector.js'
import { ConfigInspector } from './integrations/config_inspector.js'
import { QueueInspector } from './integrations/queue_inspector.js'

import type { DevToolbarOptions, ResolvedServerStatsConfig } from '../types.js'
import type { ChartBucket } from './format_helpers.js'
import type { DashboardStore } from './dashboard_store.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'

interface EdgeViewContext { render(template: string, data: Record<string, unknown>): Promise<string> }
const warnedDbReads = new Set<string>()
const SRC_DIR = dirname(fileURLToPath(import.meta.url))
const EDGE_DIR = join(SRC_DIR, '..', 'edge')
const STYLES_DIR = join(SRC_DIR, '..', 'styles')

export default class DashboardController {
  private cacheInspector: CacheInspector | null = null
  private queueInspector: QueueInspector | null = null
  private configInspector: ConfigInspector
  private cacheAvailable: boolean | null = null
  private queueAvailable: boolean | null = null
  private cachedCss: string | null = null
  private cachedJs: string | null = null
  private cachedTransmitClient: string | null = null

  constructor(private dashboardStore: DashboardStore, private app: ApplicationService) {
    this.configInspector = new ConfigInspector(app)
  }

  async page(ctx: HttpContext) {
    if (!this.checkAccess(ctx)) return ctx.response.forbidden({ error: 'Access denied' })
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    const tc: Partial<DevToolbarOptions> = config?.devToolbar ?? {}
    if (!this.cachedCss) this.initAssets(tc)
    const dp = this.getDashboardPath()
    return (ctx as unknown as { view: EdgeViewContext }).view.render('ss::dashboard', {
      css: this.cachedCss, js: this.cachedJs, transmitClient: this.cachedTransmitClient,
      dashConfig: { baseUrl: '', dashboardEndpoint: dp + '/api', debugEndpoint: tc.debugEndpoint || '/admin/api/debug', channelName: 'server-stats/dashboard', backUrl: '/' },
    })
  }

  async overview({ request, response }: HttpContext) {
    return this.withDb(response, 'overview', emptyOverview(), async () => {
      const range = request.qs().range || '1h'
      const overview = await this.dashboardStore.getOverviewMetrics(range)
      if (!overview) return emptyOverview()
      const widgets = await this.dashboardStore.getOverviewWidgets(range)
      const sparklineData = await this.dashboardStore.getSparklineData(range)
      const [cacheStats, jobQueueStatus] = await Promise.all([this.fetchCacheOverview(), this.fetchQueueOverview()])
      return { ...overview, sparklines: buildSparklines(sparklineData), ...widgets, cacheStats, jobQueueStatus }
    })
  }

  async overviewChart({ request, response }: HttpContext) {
    const range = request.qs().range || '1h'
    return this.withDb(response, 'overviewChart', { range, buckets: [] as ChartBucket[] }, async () => {
      const buckets = await this.dashboardStore.getChartData(range)
      return { range, buckets: buckets.map(mapChartBucket) }
    })
  }

  async requests({ request, response }: HttpContext) {
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || 25, 1, 100)
    return this.withDb(response, 'requests', emptyPage(page, perPage), async () => {
      const result = await this.dashboardStore.getRequests(page, perPage, {
        method: qs.method ? qs.method.toUpperCase() : undefined, url: qs.url || undefined,
        status: qs.status ? Number(qs.status) : undefined, search: qs.search || undefined,
      })
      return paginatedResponse(result.data.map(formatRequest), result.total, result.page, result.perPage)
    })
  }

  async requestDetail({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) return response.notFound({ error: 'Not found' })
    try {
      const detail = await this.dashboardStore.getRequestDetail(Number(params.id))
      if (!detail) return response.notFound({ error: 'Request not found' })
      return response.json({
        ...formatRequest(detail),
        queries: ((detail.queries as Record<string, unknown>[]) || []).map(formatQuery),
        trace: detail.trace ? formatTrace(detail.trace as Record<string, unknown>) : null,
        logs: ((detail.logs as Record<string, unknown>[]) || []).map(formatLog),
      })
    } catch { return response.notFound({ error: 'Not found' }) }
  }

  async queriesGrouped({ request, response }: HttpContext) {
    return this.withDb(response, 'queriesGrouped', { groups: [] }, async () => {
      const qs = request.qs()
      const limit = clamp(Number(qs.limit) || 50, 1, 200)
      const groups = await this.dashboardStore.getQueriesGrouped(limit, qs.sort || 'total_duration', qs.search || undefined)
      const totalTime = groups.reduce((sum: number, g: Record<string, unknown>) => sum + ((g.total_duration as number) || 0), 0)
      return { groups: groups.map((g: Record<string, unknown>) => formatGroupedQuery(g, totalTime)) }
    })
  }

  async queryExplain({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) return response.notFound({ error: 'Not found' })
    try {
      const db = this.dashboardStore.getDb()
      if (!db) return response.notFound({ error: 'Not found' })
      const query: Record<string, unknown> | undefined = await db('server_stats_queries').where('id', Number(params.id)).first()
      if (!query) return response.notFound({ error: 'Query not found' })
      if (!(query.sql_text as string).trim().toUpperCase().startsWith('SELECT')) {
        return response.badRequest({ error: 'EXPLAIN is only supported for SELECT queries' })
      }
      const lucid: unknown = await this.app.container.make('lucid.db')
      const appDb = (lucid as { connection: () => { getWriteClient: () => unknown } }).connection().getWriteClient() as Parameters<typeof runExplain>[0]
      const plan = await runExplain(appDb, query)
      return response.json({ queryId: Number(params.id), sql: query.sql_text, plan })
    } catch (error) {
      return response.internalServerError({ error: 'EXPLAIN failed', message: (error as Error)?.message ?? 'Unknown error' })
    }
  }

  async cacheStats({ request, response }: HttpContext) {
    const inspector = await this.getCacheInspector()
    if (!inspector) return response.json({ available: false, stats: null, keys: [] })
    const qs = request.qs()
    const pattern = (qs.search || qs.pattern) ? `*${qs.search || qs.pattern}*` : '*'
    try {
      const [stats, keyList] = await Promise.all([inspector.getStats(), inspector.listKeys(pattern, qs.cursor || '0', clamp(Number(qs.count) || 100, 1, 500))])
      return response.json({ available: true, stats, keys: keyList.keys, cursor: keyList.cursor })
    } catch { return response.json({ available: false, stats: null, keys: [] }) }
  }

  async cacheKey({ params, response }: HttpContext) {
    const inspector = await this.getCacheInspector()
    if (!inspector) return response.notFound({ error: 'Cache not available' })
    try {
      const detail = await inspector.getKey(decodeURIComponent(params.key))
      return detail ? response.json(detail) : response.notFound({ error: 'Key not found' })
    } catch { return response.notFound({ error: 'Key not found' }) }
  }

  async cacheKeyDelete({ params, response }: HttpContext) {
    const inspector = await this.getCacheInspector()
    if (!inspector) return response.notFound({ error: 'Cache not available' })
    try {
      return (await inspector.deleteKey(decodeURIComponent(params.key))) ? response.json({ deleted: true }) : response.notFound({ error: 'Key not found' })
    } catch { return response.internalServerError({ error: 'Failed to delete cache key' }) }
  }

  async jobs({ request, response }: HttpContext) {
    const inspector = await this.getQueueInspector()
    const emptyJobs = { available: false, overview: null, stats: null, jobs: [], total: 0 }
    if (!inspector) return response.json(emptyJobs)
    const qs = request.qs()
    const page = Math.max(1, Number(qs.page) || 1)
    const perPage = clamp(Number(qs.perPage) || Number(qs.limit) || 25, 1, 100)
    try {
      const [overview, jobList] = await Promise.all([inspector.getOverview(), inspector.listJobs(qs.status || 'all', page, perPage)])
      let jobs = jobList.jobs, total = jobList.total
      if (qs.search) { const t = qs.search.toLowerCase(); jobs = jobs.filter((j) => j.name?.toLowerCase().includes(t) || j.id?.toString().toLowerCase().includes(t)); total = jobs.length }
      return response.json({ available: true, overview, stats: overview, jobs, total, page, perPage })
    } catch { return response.json(emptyJobs) }
  }

  async jobDetail({ params, response }: HttpContext) {
    const inspector = await this.getQueueInspector()
    if (!inspector) return response.notFound({ error: 'Queue not available' })
    try {
      const detail = await inspector.getJob(String(params.id))
      return detail ? response.json(detail) : response.notFound({ error: 'Job not found' })
    } catch { return response.notFound({ error: 'Job not found' }) }
  }

  async jobRetry({ params, response }: HttpContext) {
    const inspector = await this.getQueueInspector()
    if (!inspector) return response.notFound({ error: 'Queue not available' })
    try {
      return (await inspector.retryJob(String(params.id))) ? response.json({ success: true }) : response.badRequest({ error: 'Job could not be retried (not in failed state)' })
    } catch { return response.internalServerError({ error: 'Retry failed' }) }
  }

  async config({ response }: HttpContext) {
    return response.json({ app: this.configInspector.getConfig().config, env: this.configInspector.getEnvVars().env })
  }

  async savedFilters({ response }: HttpContext) {
    return this.withDb(response, 'savedFilters', { filters: [] }, async () => {
      const filters = await this.dashboardStore.getSavedFilters()
      return { filters: filters.map((f: Record<string, unknown>) => ({ id: f.id, name: f.name, section: f.section, filterConfig: safeParseJson(f.filter_config), createdAt: f.created_at })) }
    })
  }

  async createSavedFilter({ request, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) return response.serviceUnavailable({ error: 'Database not available' })
    try {
      const { name, section, filterConfig } = request.body()
      if (!name || !section || !filterConfig) return response.badRequest({ error: 'Missing required fields: name, section, filterConfig' })
      const result = await this.dashboardStore.createSavedFilter(name, section, typeof filterConfig === 'string' ? safeParseJson(filterConfig) : filterConfig)
      return result ? response.json(result) : response.serviceUnavailable({ error: 'Database not available' })
    } catch { return response.internalServerError({ error: 'Failed to create filter' }) }
  }

  async deleteSavedFilter({ params, response }: HttpContext) {
    if (!this.dashboardStore.isReady()) return response.serviceUnavailable({ error: 'Database not available' })
    try {
      return (await this.dashboardStore.deleteSavedFilter(Number(params.id))) ? response.json({ success: true }) : response.notFound({ error: 'Filter not found' })
    } catch { return response.internalServerError({ error: 'Failed to delete filter' }) }
  }

  private initAssets(tc: Partial<DevToolbarOptions>) {
    const tokens = readFileSync(join(STYLES_DIR, 'tokens.css'), 'utf-8')
    const components = readFileSync(join(STYLES_DIR, 'components.css'), 'utf-8')
    const utilities = readFileSync(join(STYLES_DIR, 'utilities.css'), 'utf-8')
    const dashboard = readFileSync(join(STYLES_DIR, 'dashboard.css'), 'utf-8')
    this.cachedCss = tokens + '\n' + components + '\n' + utilities + '\n' + dashboard
    const clientDir = (tc.renderer || 'preact') === 'vue' ? 'client-vue' : 'client'
    this.cachedJs = readFileSync(join(EDGE_DIR, clientDir, 'dashboard.js'), 'utf-8')
    this.cachedTransmitClient = loadTransmitClient(this.app.makePath('package.json'))
  }

  private async withDb<T>(response: HttpContext['response'], label: string, emptyValue: T, fn: () => Promise<T>) {
    if (!this.dashboardStore.isReady()) return response.json(emptyValue)
    try { return response.json(await fn()) } catch (err) {
      if (!warnedDbReads.has(label)) { warnedDbReads.add(label); log.warn(`dashboard ${label}: DB read failed — ${(err as Error)?.message}`) }
      return response.json(emptyValue)
    }
  }

  private checkAccess(ctx: HttpContext): boolean {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config?.shouldShow) return true
    try { return config.shouldShow(ctx) } catch { return false }
  }

  private getDashboardPath(): string {
    return this.app.config.get<ResolvedServerStatsConfig>('server_stats')?.devToolbar?.dashboardPath ?? '/__stats'
  }

  private async getCacheInspector(): Promise<CacheInspector | null> {
    if (this.cacheAvailable === false) return null
    if (this.cacheInspector) return this.cacheInspector
    try {
      this.cacheAvailable = await CacheInspector.isAvailable(this.app)
      if (!this.cacheAvailable) return null
      this.cacheInspector = new CacheInspector(await this.app.container.make('redis'))
      return this.cacheInspector
    } catch (err) { this.cacheAvailable = false; log.warn('dashboard: CacheInspector init failed — ' + (err as Error)?.message); return null }
  }

  private async getQueueInspector(): Promise<QueueInspector | null> {
    if (this.queueAvailable === false) return null
    if (this.queueInspector) return this.queueInspector
    try {
      this.queueAvailable = await QueueInspector.isAvailable(this.app)
      if (!this.queueAvailable) return null
      this.queueInspector = new QueueInspector(await this.app.container.make('rlanz/queue'))
      return this.queueInspector
    } catch (err) { this.queueAvailable = false; log.warn('dashboard: QueueInspector init failed — ' + (err as Error)?.message); return null }
  }

  private async fetchCacheOverview() {
    try {
      const i = await this.getCacheInspector(); if (!i) return null
      const s = await i.getStats()
      return { available: true, totalKeys: s.totalKeys, hitRate: s.hitRate, memoryUsedHuman: s.memoryUsedHuman }
    } catch { return null }
  }

  private async fetchQueueOverview() {
    try {
      const i = await this.getQueueInspector(); if (!i) return null
      const o = await i.getOverview()
      return { available: true, active: o.active, waiting: o.waiting, failed: o.failed, completed: o.completed }
    } catch { return null }
  }
}
