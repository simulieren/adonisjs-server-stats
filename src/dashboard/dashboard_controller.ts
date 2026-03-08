import { log } from '../utils/logger.js'
import { clamp } from '../utils/math_helpers.js'
import { handleCacheStats, handleCacheKey, handleCacheKeyDelete } from './cache_handlers.js'
import { DashboardPageAssets } from './dashboard_page_assets.js'
import {
  handleSavedFilters,
  handleCreateSavedFilter,
  handleDeleteSavedFilter,
} from './filter_handlers.js'
import {
  paginatedResponse,
  emptyPage,
  emptyOverview,
  formatRequest,
  formatQuery,
  formatTrace,
  formatLog,
  mapChartBucket,
  buildSparklines,
  formatGroupedQuery,
} from './format_helpers.js'
import { InspectorManager } from './inspector_manager.js'
import { ConfigInspector } from './integrations/config_inspector.js'
import { handleJobs, handleJobDetail, handleJobRetry } from './jobs_handlers.js'
import { handleQueryExplain } from './query_explain_handler.js'

import type { DevToolbarOptions, ResolvedServerStatsConfig } from '../types.js'
import type { DashboardStore } from './dashboard_store.js'
import type { ChartBucket } from './format_helpers.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'

interface EdgeViewContext {
  render(template: string, data: Record<string, unknown>): Promise<string>
}

const warnedDbReads = new Set<string>()

export default class DashboardController {
  private configInspector: ConfigInspector
  private inspectors: InspectorManager
  private pageAssets: DashboardPageAssets

  constructor(
    private dashboardStore: DashboardStore,
    private app: ApplicationService
  ) {
    this.configInspector = new ConfigInspector(app)
    this.inspectors = new InspectorManager(app)
    this.pageAssets = new DashboardPageAssets()
  }

  async page(ctx: HttpContext) {
    if (!this.checkAccess(ctx)) return ctx.response.forbidden({ error: 'Access denied' })
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    const tc: Partial<DevToolbarOptions> = config?.devToolbar ?? {}
    const renderer = tc.renderer || 'preact'
    const dp = this.getDashboardPath()
    return (ctx as unknown as { view: EdgeViewContext }).view.render('ss::dashboard', {
      css: this.pageAssets.getCss(),
      js: this.pageAssets.getJs(renderer),
      transmitClient: this.pageAssets.getTransmitClient(this.app.makePath('package.json')),
      dashConfig: {
        baseUrl: '',
        dashboardEndpoint: dp + '/api',
        debugEndpoint: tc.debugEndpoint || '/admin/api/debug',
        channelName: 'server-stats/dashboard',
        backUrl: '/',
      },
    })
  }

  async overview({ request, response }: HttpContext) {
    return this.withDb(response, 'overview', emptyOverview(), async () => {
      const range = request.qs().range || '1h'
      const overview = await this.dashboardStore.getOverviewMetrics(range)
      if (!overview) return emptyOverview()
      const widgets = await this.dashboardStore.getOverviewWidgets(range)
      const sparklineData = await this.dashboardStore.getSparklineData(range)
      const [cacheStats, jobQueueStatus] = await Promise.all([
        this.inspectors.fetchCacheOverview(),
        this.inspectors.fetchQueueOverview(),
      ])
      return {
        ...overview,
        sparklines: buildSparklines(sparklineData),
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
        return { range, buckets: buckets.map(mapChartBucket) }
      }
    )
  }

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
    } catch {
      return response.notFound({ error: 'Not found' })
    }
  }

  async queriesGrouped({ request, response }: HttpContext) {
    return this.withDb(response, 'queriesGrouped', { groups: [] }, async () => {
      const qs = request.qs()
      const limit = clamp(Number(qs.limit) || 50, 1, 200)
      const groups = await this.dashboardStore.getQueriesGrouped(
        limit,
        qs.sort || 'total_duration',
        qs.search || undefined
      )
      const totalTime = groups.reduce(
        (sum: number, g: Record<string, unknown>) => sum + ((g.total_duration as number) || 0),
        0
      )
      return {
        groups: groups.map((g: Record<string, unknown>) => formatGroupedQuery(g, totalTime)),
      }
    })
  }

  async queryExplain(ctx: HttpContext) {
    return handleQueryExplain(this.dashboardStore, this.app, ctx)
  }

  async cacheStats(ctx: HttpContext) {
    return handleCacheStats(this.inspectors, ctx)
  }

  async cacheKey(ctx: HttpContext) {
    return handleCacheKey(this.inspectors, ctx)
  }

  async cacheKeyDelete(ctx: HttpContext) {
    return handleCacheKeyDelete(this.inspectors, ctx)
  }

  async jobs(ctx: HttpContext) {
    return handleJobs(this.inspectors, ctx)
  }

  async jobDetail(ctx: HttpContext) {
    return handleJobDetail(this.inspectors, ctx)
  }

  async jobRetry(ctx: HttpContext) {
    return handleJobRetry(this.inspectors, ctx)
  }

  async config({ response }: HttpContext) {
    return response.json({
      app: this.configInspector.getConfig().config,
      env: this.configInspector.getEnvVars().env,
    })
  }

  async savedFilters({ response }: HttpContext) {
    return this.withDb(response, 'savedFilters', { filters: [] }, () =>
      handleSavedFilters(this.dashboardStore)
    )
  }

  async createSavedFilter(ctx: HttpContext) {
    return handleCreateSavedFilter(this.dashboardStore, ctx)
  }

  async deleteSavedFilter(ctx: HttpContext) {
    return handleDeleteSavedFilter(this.dashboardStore, ctx)
  }

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
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config?.shouldShow) return true
    try {
      return config.shouldShow(ctx)
    } catch {
      return false
    }
  }

  private getDashboardPath(): string {
    return (
      this.app.config.get<ResolvedServerStatsConfig>('server_stats')?.devToolbar?.dashboardPath ??
      '/__stats'
    )
  }
}
