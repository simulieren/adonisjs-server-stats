import { log } from '../utils/logger.js'
import { clampPerPage } from '../dashboard/paginate_helper.js'

import type { ApiController } from '../controller/api_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'

type WhenReady = (() => Promise<void>) | undefined

/**
 * Lightweight CSRF guard for state-changing routes. Since `noSessionMiddleware`
 * strips `Set-Cookie`, session-based CSRF tokens can't apply — instead we require
 * the request to be provably same-origin (via the `Sec-Fetch-Site` fetch-metadata
 * header) or to carry an `X-Requested-With` header, neither of which a cross-site
 * form/navigation can forge. Returns true when the request is allowed.
 */
function isSameOriginRequest(ctx: HttpContext): boolean {
  const fetchSite = ctx.request.header('sec-fetch-site')
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none'
  // Older clients without fetch metadata: require an explicit XHR marker,
  // which a cross-site simple form submission cannot set.
  return !!ctx.request.header('x-requested-with')
}

/** Wrap a dashboard handler so it rejects cross-site state-changing requests. */
function guardCsrf(
  handler: (ctx: HttpContext) => Promise<unknown>
): (ctx: HttpContext) => Promise<unknown> {
  return async (ctx: HttpContext) => {
    if (!isSameOriginRequest(ctx)) {
      return ctx.response.forbidden({ error: 'Cross-site request blocked' })
    }
    return handler(ctx)
  }
}

function bindDash(
  getController: () => DashboardController | null,
  method: keyof DashboardController,
  whenReady: WhenReady
) {
  return async (ctx: HttpContext) => {
    if (whenReady) await whenReady()
    const controller = getController()
    if (!controller) {
      log.warn(
        `503 on ${ctx.request.url()} — dashboardController is null (method: ${method}). ` +
          'Dashboard may still be initializing or failed to start. Check for earlier errors.'
      )
      return ctx.response.serviceUnavailable({
        error: 'Dashboard is not available. Check server logs for initialization errors.',
      })
    }
    return (controller[method] as (ctx: HttpContext) => Promise<unknown>).call(controller, ctx)
  }
}

function bindApi(
  getApi: () => ApiController | null,
  fn: (api: ApiController, ctx: HttpContext) => Promise<unknown> | unknown,
  whenReady: WhenReady
) {
  return async (ctx: HttpContext) => {
    if (whenReady) await whenReady()
    const api = getApi()
    if (!api) {
      log.warn(
        `503 on ${ctx.request.url()} — apiController is null. ` +
          'Dashboard may still be initializing or failed to start. Check for earlier errors.'
      )
      return ctx.response.serviceUnavailable({
        error: 'Dashboard is not available. Check server logs for initialization errors.',
      })
    }
    return fn(api, ctx)
  }
}

function registerQueryRoutes(
  router: AdonisRouter,
  getApi: () => ApiController | null,
  whenReady: WhenReady
) {
  router
    .get(
      '/api/queries',
      bindApi(
        getApi,
        async (api, ctx) => {
          const qs = ctx.request.qs()
          return ctx.response.json(
            await api.getQueries({
              page: Number(qs.page) || 1,
              perPage: clampPerPage(Number(qs.perPage) || 25),
              search: qs.search || undefined,
              filters: {
                durationMin: qs.duration_min ? Number(qs.duration_min) : undefined,
                model: qs.model || undefined,
                method: qs.method || undefined,
                connection: qs.connection || undefined,
              },
            })
          )
        },
        whenReady
      )
    )
    .as('server-stats.queries')
}

function registerEventRoutes(
  router: AdonisRouter,
  getApi: () => ApiController | null,
  whenReady: WhenReady
) {
  router
    .get(
      '/api/events',
      bindApi(
        getApi,
        async (api, ctx) => {
          const qs = ctx.request.qs()
          return ctx.response.json(
            await api.getEvents({
              page: Number(qs.page) || 1,
              perPage: clampPerPage(Number(qs.perPage) || 25),
              search: qs.search || undefined,
              filters: { eventName: qs.event_name || undefined },
            })
          )
        },
        whenReady
      )
    )
    .as('server-stats.events')
}

function registerRouteApiRoutes(
  router: AdonisRouter,
  getApi: () => ApiController | null,
  whenReady: WhenReady
) {
  router
    .get(
      '/api/routes',
      bindApi(
        getApi,
        (api, ctx) => ctx.response.json(api.getRoutes(ctx.request.qs().search || undefined)),
        whenReady
      )
    )
    .as('server-stats.routes')
}

function registerLogRoutes(
  router: AdonisRouter,
  getApi: () => ApiController | null,
  whenReady: WhenReady
) {
  router
    .get(
      '/api/logs',
      bindApi(
        getApi,
        async (api, ctx) => {
          const qs = ctx.request.qs()
          return ctx.response.json(
            await api.getLogs({
              page: Number(qs.page) || 1,
              perPage: clampPerPage(Number(qs.perPage) || 50),
              search: qs.message || qs.search || undefined,
              filters: {
                level: qs.level || undefined,
                requestId: qs.request_id || qs.requestId || undefined,
              },
            })
          )
        },
        whenReady
      )
    )
    .as('server-stats.logs')
}

function registerEmailRoutes(
  router: AdonisRouter,
  getApi: () => ApiController | null,
  whenReady: WhenReady
) {
  router
    .get(
      '/api/emails',
      bindApi(
        getApi,
        async (api, ctx) => {
          const qs = ctx.request.qs()
          return ctx.response.json(
            await api.getEmails({
              page: Number(qs.page) || 1,
              perPage: clampPerPage(Number(qs.perPage) || 25),
              search: qs.search || undefined,
              filters: {
                from: qs.from || undefined,
                to: qs.to || undefined,
                subject: qs.subject || undefined,
                status: qs.status || undefined,
                mailer: qs.mailer || undefined,
              },
            })
          )
        },
        whenReady
      )
    )
    .as('server-stats.emails')
  router
    .get(
      '/api/emails/:id/preview',
      bindApi(
        getApi,
        async (api, ctx) => {
          const html = await api.getEmailPreview(Number(ctx.params.id))
          if (!html) return ctx.response.notFound({ error: 'Email not found' })
          return ctx.response
            .header('Content-Type', 'text/html; charset=utf-8')
            .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
            .header('X-Content-Type-Options', 'nosniff')
            .header('X-Frame-Options', 'SAMEORIGIN')
            .send(html)
        },
        whenReady
      )
    )
    .as('server-stats.emails.preview')
}

function registerTraceRoutes(
  router: AdonisRouter,
  getApi: () => ApiController | null,
  whenReady: WhenReady
) {
  router
    .get(
      '/api/traces',
      bindApi(
        getApi,
        async (api, ctx) => {
          const qs = ctx.request.qs()
          return ctx.response.json(
            await api.getTraces({
              page: Number(qs.page) || 1,
              perPage: clampPerPage(Number(qs.perPage) || 25),
              search: qs.search || undefined,
              filters: {
                method: qs.method ? qs.method.toUpperCase() : undefined,
                url: qs.url || undefined,
                statusMin: qs.status_min ? Number(qs.status_min) : undefined,
                statusMax: qs.status_max ? Number(qs.status_max) : undefined,
              },
            })
          )
        },
        whenReady
      )
    )
    .as('server-stats.traces')
  router
    .get(
      '/api/traces/:id',
      bindApi(
        getApi,
        async (api, ctx) => {
          const trace = await api.getTraceDetail(Number(ctx.params.id))
          if (!trace) return ctx.response.notFound({ error: 'Trace not found' })
          return ctx.response.json(trace)
        },
        whenReady
      )
    )
    .as('server-stats.traces.show')
}

function registerDashboardPageRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null,
  whenReady: WhenReady
) {
  router.get('/', bindDash(getDashboardController, 'page', whenReady)).as('server-stats.dashboard')
  router
    .get('/api/overview', bindDash(getDashboardController, 'overview', whenReady))
    .as('server-stats.overview')
  router
    .get('/api/overview/chart', bindDash(getDashboardController, 'overviewChart', whenReady))
    .as('server-stats.overview.chart')
  router
    .get('/api/requests', bindDash(getDashboardController, 'requests', whenReady))
    .as('server-stats.requests')
  router
    .get('/api/requests/:id', bindDash(getDashboardController, 'requestDetail', whenReady))
    .as('server-stats.requests.show')
}

function registerQueryDashboardRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null,
  whenReady: WhenReady
) {
  router
    .get('/api/queries/grouped', bindDash(getDashboardController, 'queriesGrouped', whenReady))
    .as('server-stats.queries.grouped')
  router
    .get('/api/queries/:id/explain', bindDash(getDashboardController, 'queryExplain', whenReady))
    .as('server-stats.queries.explain')
}

function registerCacheRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null,
  whenReady: WhenReady
) {
  router
    .get('/api/cache', bindDash(getDashboardController, 'cacheStats', whenReady))
    .as('server-stats.cache')
  router
    .get('/api/cache/:key', bindDash(getDashboardController, 'cacheKey', whenReady))
    .as('server-stats.cache.show')
    .where('key', /.*/)
  router
    .delete(
      '/api/cache/:key',
      guardCsrf(bindDash(getDashboardController, 'cacheKeyDelete', whenReady))
    )
    .as('server-stats.cache.delete')
    .where('key', /.*/)
}

function registerJobRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null,
  whenReady: WhenReady
) {
  router
    .get('/api/jobs', bindDash(getDashboardController, 'jobs', whenReady))
    .as('server-stats.jobs')
  router
    .get('/api/jobs/:id', bindDash(getDashboardController, 'jobDetail', whenReady))
    .as('server-stats.jobs.show')
  router
    .post('/api/jobs/:id/retry', guardCsrf(bindDash(getDashboardController, 'jobRetry', whenReady)))
    .as('server-stats.jobs.retry')
}

function registerConfigAndFilterRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null,
  whenReady: WhenReady
) {
  router
    .get('/api/config', bindDash(getDashboardController, 'config', whenReady))
    .as('server-stats.config')
  router
    .get('/api/filters', bindDash(getDashboardController, 'savedFilters', whenReady))
    .as('server-stats.filters')
  router
    .post('/api/filters', guardCsrf(bindDash(getDashboardController, 'createSavedFilter', whenReady)))
    .as('server-stats.filters.create')
  router
    .delete(
      '/api/filters/:id',
      guardCsrf(bindDash(getDashboardController, 'deleteSavedFilter', whenReady))
    )
    .as('server-stats.filters.delete')
}

interface DashboardRoutesOpts {
  router: AdonisRouter
  dashboardPath: string
  getDashboardController: () => DashboardController | null
  getApiController: () => ApiController | null
  middleware: Array<(ctx: HttpContext, next: () => Promise<void>) => Promise<void>>
  whenReady?: () => Promise<void>
}

/** Register dashboard routes. */
export function registerDashboardRoutes(opts: DashboardRoutesOpts) {
  const { router, dashboardPath, getDashboardController, getApiController, middleware } = opts
  const whenReady = opts.whenReady
  const base = dashboardPath.replace(/\/+$/, '')

  router
    .group(() => {
      registerDashboardPageRoutes(router, getDashboardController, whenReady)
      registerQueryRoutes(router, getApiController, whenReady)
      registerEventRoutes(router, getApiController, whenReady)
      registerRouteApiRoutes(router, getApiController, whenReady)
      registerLogRoutes(router, getApiController, whenReady)
      registerEmailRoutes(router, getApiController, whenReady)
      registerTraceRoutes(router, getApiController, whenReady)
      registerQueryDashboardRoutes(router, getDashboardController, whenReady)
      registerCacheRoutes(router, getDashboardController, whenReady)
      registerJobRoutes(router, getDashboardController, whenReady)
      registerConfigAndFilterRoutes(router, getDashboardController, whenReady)
    })
    .prefix(base)
    .use(middleware)
}
