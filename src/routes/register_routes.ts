import { createAccessMiddleware } from './access_middleware.js'

import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for the unified route registration function.
 *
 * Brings together stats, debug, and dashboard route registration
 * into a single call with all required dependencies declared upfront.
 */
export interface RegisterRoutesOptions {
  /** The AdonisJS router instance. */
  router: AdonisRouter

  /**
   * The unified API controller that serves all data resource endpoints
   * (queries, events, emails, traces, routes, logs).
   *
   * Pass `null` during early boot — routes will return 503 until the
   * controller is wired up.
   */
  getApiController: () => ApiController | null

  /**
   * Lazy getter for the stats bar controller.
   *
   * The controller is created during `ready()`, but routes are
   * registered during `boot()`, so a lazy getter is required.
   */
  getStatsController: () => ServerStatsController | null

  /**
   * Lazy getter for the debug controller.
   *
   * Handles non-data debug endpoints: `/config` and `/diagnostics`.
   */
  getDebugController: () => DebugController | null

  /**
   * Lazy getter for the dashboard controller.
   *
   * Handles dashboard-specific endpoints that are **not** data
   * resources: page rendering, overview, requests, cache, jobs,
   * config, saved filters, grouped queries, and query explain.
   */
  getDashboardController: () => DashboardController | null

  /**
   * Stats polling endpoint path (e.g. `'/admin/api/server-stats'`).
   *
   * Set to `false` to skip registering the stats endpoint entirely.
   */
  statsEndpoint?: string | false

  /**
   * Base path for debug panel API routes (e.g. `'/admin/api/debug'`).
   *
   * When omitted, debug routes are **not** registered.
   */
  debugEndpoint?: string

  /**
   * Base path for the full-page dashboard (e.g. `'/__stats'`).
   *
   * When omitted, dashboard routes are **not** registered.
   */
  dashboardPath?: string

  /**
   * Optional access-control callback applied to **all** registered
   * routes as middleware. When it returns `false`, the request
   * receives a 403 Forbidden response.
   */
  shouldShow?: (ctx: HttpContext) => boolean
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all server-stats routes in a single call.
 *
 * This is the unified replacement for the three separate registrars:
 *
 * - `registerStatsRoutes`     — stats bar polling endpoint
 * - `registerDebugRoutes`     — debug panel API endpoints
 * - `registerDashboardRoutes` — full-page dashboard endpoints
 *
 * **Data resource** endpoints (queries, events, emails, traces, routes,
 * logs) are routed through the unified {@link ApiController} so that
 * both the debug panel and the dashboard read from the same handler.
 *
 * **Non-data** endpoints (stats polling, config, diagnostics, overview,
 * requests, cache, jobs, saved filters, grouped queries, query explain,
 * and the dashboard HTML page) continue to use their original controllers.
 *
 * @example
 * ```ts
 * registerAllRoutes({
 *   router,
 *   getApiController: () => apiController,
 *   getStatsController: () => statsController,
 *   getDebugController: () => debugController,
 *   getDashboardController: () => dashboardController,
 *   statsEndpoint: '/admin/api/server-stats',
 *   debugEndpoint: '/admin/api/debug',
 *   dashboardPath: '/__stats',
 *   shouldShow: (ctx) => ctx.auth?.user?.role === 'admin',
 * })
 * ```
 */
export function registerAllRoutes(options: RegisterRoutesOptions): void {
  const {
    router,
    getApiController,
    getStatsController,
    getDebugController,
    getDashboardController,
    statsEndpoint,
    debugEndpoint,
    dashboardPath,
    shouldShow,
  } = options

  const middleware = shouldShow ? [createAccessMiddleware(shouldShow)] : []

  // =========================================================================
  // Stats polling endpoint
  // =========================================================================

  if (typeof statsEndpoint === 'string') {
    router
      .get(statsEndpoint, async (ctx: HttpContext) => {
        const controller = getStatsController()
        if (!controller) {
          return ctx.response.serviceUnavailable({
            error: 'Stats engine is starting up, please retry',
          })
        }
        return controller.index(ctx)
      })
      .as('server-stats.api')
      .use(middleware)
  }

  // =========================================================================
  // Debug panel API routes
  // =========================================================================

  if (debugEndpoint) {
    const base = debugEndpoint.replace(/\/+$/, '')

    /**
     * Bind a debug controller method with lazy initialization and
     * 503 fallback when the controller is not yet ready.
     */
    const bindDebug = (method: keyof DebugController) => {
      return async (ctx: HttpContext) => {
        const controller = getDebugController()
        if (!controller) {
          return ctx.response.serviceUnavailable({
            error: 'Debug toolbar is starting up, please retry',
          })
        }
        return (controller[method] as (ctx: HttpContext) => Promise<unknown>).call(controller, ctx)
      }
    }

    /**
     * Wrap an ApiController method as an HTTP handler with lazy
     * initialization and 503 fallback.
     */
    const bindApi = (fn: (api: ApiController, ctx: HttpContext) => Promise<unknown> | unknown) => {
      return async (ctx: HttpContext) => {
        const api = getApiController()
        if (!api) {
          return ctx.response.serviceUnavailable({
            error: 'Debug toolbar is starting up, please retry',
          })
        }
        return fn(api, ctx)
      }
    }

    router
      .group(() => {
        // Non-data endpoints — stay with DebugController
        router.get('/config', bindDebug('config')).as('server-stats.debug.config')
        router.get('/diagnostics', bindDebug('diagnostics')).as('server-stats.debug.diagnostics')

        // Data endpoints — unified through ApiController
        // Debug panel always reads from ring buffers (source: 'memory')
        // because SQLite column names (snake_case) differ from the
        // camelCase QueryRecord/EventRecord/etc. shapes the frontend expects.
        router
          .get(
            '/queries',
            bindApi(async (api, ctx) => {
              const queries = await api.getQueries({ source: 'memory' })
              const summary = api.getQuerySummary()
              return ctx.response.json({ queries: queries.data, summary })
            })
          )
          .as('server-stats.debug.queries')

        router
          .get(
            '/events',
            bindApi(async (api, ctx) => {
              const result = await api.getEvents({ source: 'memory' })
              return ctx.response.json({ events: result.data, total: result.meta.total })
            })
          )
          .as('server-stats.debug.events')

        router
          .get(
            '/routes',
            bindApi((api, ctx) => {
              const result = api.getRoutes()
              return ctx.response.json({ routes: result.data, total: result.meta.total })
            })
          )
          .as('server-stats.debug.routes')

        router
          .get(
            '/logs',
            bindApi(async (api, ctx) => {
              const result = await api.getLogs({ source: 'memory' })
              return ctx.response.json(result.data)
            })
          )
          .as('server-stats.debug.logs')

        router
          .get(
            '/emails',
            bindApi(async (api, ctx) => {
              const result = await api.getEmails({ source: 'memory' })
              return ctx.response.json({ emails: result.data, total: result.meta.total })
            })
          )
          .as('server-stats.debug.emails')

        router
          .get(
            '/emails/:id/preview',
            bindApi(async (api, ctx) => {
              const id = Number(ctx.params.id)
              const html = await api.getEmailPreview(id, 'memory')
              if (!html) {
                return ctx.response.notFound({ error: 'Email not found' })
              }
              return ctx.response.header('Content-Type', 'text/html; charset=utf-8').send(html)
            })
          )
          .as('server-stats.debug.emailPreview')

        router
          .get(
            '/traces',
            bindApi(async (api, ctx) => {
              const result = await api.getTraces({ source: 'memory' })
              return ctx.response.json({ traces: result.data, total: result.meta.total })
            })
          )
          .as('server-stats.debug.traces')

        router
          .get(
            '/traces/:id',
            bindApi(async (api, ctx) => {
              const id = Number(ctx.params.id)
              const trace = await api.getTraceDetail(id, 'memory')
              if (!trace) {
                return ctx.response.notFound({ error: 'Trace not found' })
              }
              return ctx.response.json(trace)
            })
          )
          .as('server-stats.debug.traceDetail')
      })
      .prefix(base)
      .use(middleware)
  }

  // =========================================================================
  // Dashboard routes
  // =========================================================================

  if (dashboardPath) {
    const base = dashboardPath.replace(/\/+$/, '')

    /**
     * Bind a dashboard controller method with lazy initialization
     * and 503 fallback.
     */
    const bindDash = (method: keyof DashboardController) => {
      return async (ctx: HttpContext) => {
        const controller = getDashboardController()
        if (!controller) {
          return ctx.response.serviceUnavailable({
            error: 'Dashboard is starting up, please retry',
          })
        }
        return (controller[method] as (ctx: HttpContext) => Promise<unknown>).call(controller, ctx)
      }
    }

    /**
     * Wrap an ApiController method as a dashboard HTTP handler with
     * lazy initialization and 503 fallback.
     */
    const bindApi = (fn: (api: ApiController, ctx: HttpContext) => Promise<unknown> | unknown) => {
      return async (ctx: HttpContext) => {
        const api = getApiController()
        if (!api) {
          return ctx.response.serviceUnavailable({
            error: 'Dashboard is starting up, please retry',
          })
        }
        return fn(api, ctx)
      }
    }

    router
      .group(() => {
        // ── Page ────────────────────────────────────────────────────
        router.get('/', bindDash('page')).as('server-stats.dashboard')

        // ── Overview (dashboard-only) ───────────────────────────────
        router.get('/api/overview', bindDash('overview')).as('server-stats.overview')
        router
          .get('/api/overview/chart', bindDash('overviewChart'))
          .as('server-stats.overview.chart')

        // ── Requests (dashboard-only) ───────────────────────────────
        router.get('/api/requests', bindDash('requests')).as('server-stats.requests')
        router.get('/api/requests/:id', bindDash('requestDetail')).as('server-stats.requests.show')

        // ── Queries — unified data via ApiController ────────────────
        router
          .get(
            '/api/queries',
            bindApi(async (api, ctx) => {
              const qs = ctx.request.qs()
              const result = await api.getQueries({
                page: Number(qs.page) || 1,
                perPage: Number(qs.perPage) || 25,
                search: qs.search || undefined,
                filters: {
                  durationMin: qs.duration_min ? Number(qs.duration_min) : undefined,
                  model: qs.model || undefined,
                  method: qs.method || undefined,
                  connection: qs.connection || undefined,
                },
              })
              return ctx.response.json(result)
            })
          )
          .as('server-stats.queries')

        // Grouped queries and explain stay on DashboardController
        router
          .get('/api/queries/grouped', bindDash('queriesGrouped'))
          .as('server-stats.queries.grouped')
        router
          .get('/api/queries/:id/explain', bindDash('queryExplain'))
          .as('server-stats.queries.explain')

        // ── Events — unified data via ApiController ─────────────────
        router
          .get(
            '/api/events',
            bindApi(async (api, ctx) => {
              const qs = ctx.request.qs()
              const result = await api.getEvents({
                page: Number(qs.page) || 1,
                perPage: Number(qs.perPage) || 25,
                search: qs.search || undefined,
                filters: {
                  eventName: qs.event_name || undefined,
                },
              })
              return ctx.response.json(result)
            })
          )
          .as('server-stats.events')

        // ── Routes — unified data via ApiController ─────────────────
        router
          .get(
            '/api/routes',
            bindApi((api, ctx) => {
              const qs = ctx.request.qs()
              const result = api.getRoutes(qs.search || undefined)
              return ctx.response.json(result)
            })
          )
          .as('server-stats.routes')

        // ── Logs — unified data via ApiController ───────────────────
        router
          .get(
            '/api/logs',
            bindApi(async (api, ctx) => {
              const qs = ctx.request.qs()
              const result = await api.getLogs({
                page: Number(qs.page) || 1,
                perPage: Number(qs.perPage) || 50,
                search: qs.message || qs.search || undefined,
                filters: {
                  level: qs.level || undefined,
                  requestId: qs.request_id || qs.requestId || undefined,
                },
              })
              return ctx.response.json(result)
            })
          )
          .as('server-stats.logs')

        // ── Emails — unified data via ApiController ─────────────────
        router
          .get(
            '/api/emails',
            bindApi(async (api, ctx) => {
              const qs = ctx.request.qs()
              const result = await api.getEmails({
                page: Number(qs.page) || 1,
                perPage: Number(qs.perPage) || 25,
                search: qs.search || undefined,
                filters: {
                  from: qs.from || undefined,
                  to: qs.to || undefined,
                  subject: qs.subject || undefined,
                  status: qs.status || undefined,
                  mailer: qs.mailer || undefined,
                },
              })
              return ctx.response.json(result)
            })
          )
          .as('server-stats.emails')

        router
          .get(
            '/api/emails/:id/preview',
            bindApi(async (api, ctx) => {
              const id = Number(ctx.params.id)
              const html = await api.getEmailPreview(id)
              if (!html) {
                return ctx.response.notFound({ error: 'Email not found' })
              }
              return ctx.response.header('Content-Type', 'text/html; charset=utf-8').send(html)
            })
          )
          .as('server-stats.emails.preview')

        // ── Traces — unified data via ApiController ─────────────────
        router
          .get(
            '/api/traces',
            bindApi(async (api, ctx) => {
              const qs = ctx.request.qs()
              const result = await api.getTraces({
                page: Number(qs.page) || 1,
                perPage: Number(qs.perPage) || 25,
                search: qs.search || undefined,
                filters: {
                  method: qs.method ? qs.method.toUpperCase() : undefined,
                  url: qs.url || undefined,
                  statusMin: qs.status_min ? Number(qs.status_min) : undefined,
                  statusMax: qs.status_max ? Number(qs.status_max) : undefined,
                },
              })
              return ctx.response.json(result)
            })
          )
          .as('server-stats.traces')

        router
          .get(
            '/api/traces/:id',
            bindApi(async (api, ctx) => {
              const id = Number(ctx.params.id)
              const trace = await api.getTraceDetail(id)
              if (!trace) {
                return ctx.response.notFound({ error: 'Trace not found' })
              }
              return ctx.response.json(trace)
            })
          )
          .as('server-stats.traces.show')

        // ── Cache (dashboard-only) ──────────────────────────────────
        router.get('/api/cache', bindDash('cacheStats')).as('server-stats.cache')
        router
          .get('/api/cache/:key', bindDash('cacheKey'))
          .as('server-stats.cache.show')
          .where('key', /.*/)
        router
          .delete('/api/cache/:key', bindDash('cacheKeyDelete'))
          .as('server-stats.cache.delete')
          .where('key', /.*/)

        // ── Jobs / Queue (dashboard-only) ───────────────────────────
        router.get('/api/jobs', bindDash('jobs')).as('server-stats.jobs')
        router.get('/api/jobs/:id', bindDash('jobDetail')).as('server-stats.jobs.show')
        router.post('/api/jobs/:id/retry', bindDash('jobRetry')).as('server-stats.jobs.retry')

        // ── Config (dashboard-only) ─────────────────────────────────
        router.get('/api/config', bindDash('config')).as('server-stats.config')

        // ── Saved Filters (dashboard-only) ──────────────────────────
        router.get('/api/filters', bindDash('savedFilters')).as('server-stats.filters')
        router.post('/api/filters', bindDash('createSavedFilter')).as('server-stats.filters.create')
        router
          .delete('/api/filters/:id', bindDash('deleteSavedFilter'))
          .as('server-stats.filters.delete')
      })
      .prefix(base)
      .use(middleware)
  }
}
