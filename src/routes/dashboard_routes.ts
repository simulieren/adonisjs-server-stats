import { log } from '../utils/logger.js'

import type { ApiController } from '../controller/api_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'

function bindDash(
  getController: () => DashboardController | null,
  method: keyof DashboardController
) {
  return async (ctx: HttpContext) => {
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
  fn: (api: ApiController, ctx: HttpContext) => Promise<unknown> | unknown
) {
  return async (ctx: HttpContext) => {
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

function registerQueryRoutes(router: AdonisRouter, getApi: () => ApiController | null) {
  router
    .get(
      '/api/queries',
      bindApi(getApi, async (api, ctx) => {
        const qs = ctx.request.qs()
        return ctx.response.json(
          await api.getQueries({
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
        )
      })
    )
    .as('server-stats.queries')
}

function registerEventRoutes(router: AdonisRouter, getApi: () => ApiController | null) {
  router
    .get(
      '/api/events',
      bindApi(getApi, async (api, ctx) => {
        const qs = ctx.request.qs()
        return ctx.response.json(
          await api.getEvents({
            page: Number(qs.page) || 1,
            perPage: Number(qs.perPage) || 25,
            search: qs.search || undefined,
            filters: { eventName: qs.event_name || undefined },
          })
        )
      })
    )
    .as('server-stats.events')
}

function registerRouteApiRoutes(router: AdonisRouter, getApi: () => ApiController | null) {
  router
    .get(
      '/api/routes',
      bindApi(getApi, (api, ctx) =>
        ctx.response.json(api.getRoutes(ctx.request.qs().search || undefined))
      )
    )
    .as('server-stats.routes')
}

function registerLogRoutes(router: AdonisRouter, getApi: () => ApiController | null) {
  router
    .get(
      '/api/logs',
      bindApi(getApi, async (api, ctx) => {
        const qs = ctx.request.qs()
        return ctx.response.json(
          await api.getLogs({
            page: Number(qs.page) || 1,
            perPage: Number(qs.perPage) || 50,
            search: qs.message || qs.search || undefined,
            filters: {
              level: qs.level || undefined,
              requestId: qs.request_id || qs.requestId || undefined,
            },
          })
        )
      })
    )
    .as('server-stats.logs')
}

function registerEmailRoutes(router: AdonisRouter, getApi: () => ApiController | null) {
  router
    .get(
      '/api/emails',
      bindApi(getApi, async (api, ctx) => {
        const qs = ctx.request.qs()
        return ctx.response.json(
          await api.getEmails({
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
        )
      })
    )
    .as('server-stats.emails')
  router
    .get(
      '/api/emails/:id/preview',
      bindApi(getApi, async (api, ctx) => {
        const html = await api.getEmailPreview(Number(ctx.params.id))
        if (!html) return ctx.response.notFound({ error: 'Email not found' })
        return ctx.response.header('Content-Type', 'text/html; charset=utf-8').send(html)
      })
    )
    .as('server-stats.emails.preview')
}

function registerTraceRoutes(router: AdonisRouter, getApi: () => ApiController | null) {
  router
    .get(
      '/api/traces',
      bindApi(getApi, async (api, ctx) => {
        const qs = ctx.request.qs()
        return ctx.response.json(
          await api.getTraces({
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
        )
      })
    )
    .as('server-stats.traces')
  router
    .get(
      '/api/traces/:id',
      bindApi(getApi, async (api, ctx) => {
        const trace = await api.getTraceDetail(Number(ctx.params.id))
        if (!trace) return ctx.response.notFound({ error: 'Trace not found' })
        return ctx.response.json(trace)
      })
    )
    .as('server-stats.traces.show')
}

function registerDashboardPageRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null
) {
  router.get('/', bindDash(getDashboardController, 'page')).as('server-stats.dashboard')
  router
    .get('/api/overview', bindDash(getDashboardController, 'overview'))
    .as('server-stats.overview')
  router
    .get('/api/overview/chart', bindDash(getDashboardController, 'overviewChart'))
    .as('server-stats.overview.chart')
  router
    .get('/api/requests', bindDash(getDashboardController, 'requests'))
    .as('server-stats.requests')
  router
    .get('/api/requests/:id', bindDash(getDashboardController, 'requestDetail'))
    .as('server-stats.requests.show')
}

function registerQueryDashboardRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null
) {
  router
    .get('/api/queries/grouped', bindDash(getDashboardController, 'queriesGrouped'))
    .as('server-stats.queries.grouped')
  router
    .get('/api/queries/:id/explain', bindDash(getDashboardController, 'queryExplain'))
    .as('server-stats.queries.explain')
}

function registerCacheRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null
) {
  router.get('/api/cache', bindDash(getDashboardController, 'cacheStats')).as('server-stats.cache')
  router
    .get('/api/cache/:key', bindDash(getDashboardController, 'cacheKey'))
    .as('server-stats.cache.show')
    .where('key', /.*/)
  router
    .delete('/api/cache/:key', bindDash(getDashboardController, 'cacheKeyDelete'))
    .as('server-stats.cache.delete')
    .where('key', /.*/)
}

function registerJobRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null
) {
  router.get('/api/jobs', bindDash(getDashboardController, 'jobs')).as('server-stats.jobs')
  router
    .get('/api/jobs/:id', bindDash(getDashboardController, 'jobDetail'))
    .as('server-stats.jobs.show')
  router
    .post('/api/jobs/:id/retry', bindDash(getDashboardController, 'jobRetry'))
    .as('server-stats.jobs.retry')
}

function registerConfigAndFilterRoutes(
  router: AdonisRouter,
  getDashboardController: () => DashboardController | null
) {
  router.get('/api/config', bindDash(getDashboardController, 'config')).as('server-stats.config')
  router
    .get('/api/filters', bindDash(getDashboardController, 'savedFilters'))
    .as('server-stats.filters')
  router
    .post('/api/filters', bindDash(getDashboardController, 'createSavedFilter'))
    .as('server-stats.filters.create')
  router
    .delete('/api/filters/:id', bindDash(getDashboardController, 'deleteSavedFilter'))
    .as('server-stats.filters.delete')
}

interface DashboardRoutesOpts {
  router: AdonisRouter
  dashboardPath: string
  getDashboardController: () => DashboardController | null
  getApiController: () => ApiController | null
  middleware: Array<(ctx: HttpContext, next: () => Promise<void>) => Promise<void>>
}

/** Register dashboard routes. */
export function registerDashboardRoutes(opts: DashboardRoutesOpts) {
  const { router, dashboardPath, getDashboardController, getApiController, middleware } = opts
  const base = dashboardPath.replace(/\/+$/, '')

  router
    .group(() => {
      registerDashboardPageRoutes(router, getDashboardController)
      registerQueryRoutes(router, getApiController)
      registerEventRoutes(router, getApiController)
      registerRouteApiRoutes(router, getApiController)
      registerLogRoutes(router, getApiController)
      registerEmailRoutes(router, getApiController)
      registerTraceRoutes(router, getApiController)
      registerQueryDashboardRoutes(router, getDashboardController)
      registerCacheRoutes(router, getDashboardController)
      registerJobRoutes(router, getDashboardController)
      registerConfigAndFilterRoutes(router, getDashboardController)
    })
    .prefix(base)
    .use(middleware)
}
