import { getAppDbClient, buildExplainSql, extractPlan } from '../dashboard/query_explain_handler.js'

import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'

let _whenReady: (() => Promise<void>) | undefined

function bindDebug(getController: () => DebugController | null, method: keyof DebugController) {
  return async (ctx: HttpContext) => {
    if (_whenReady) await _whenReady()
    const controller = getController()
    if (!controller)
      return ctx.response.serviceUnavailable({
        error: 'Debug toolbar is starting up, please retry',
      })
    return (controller[method] as (ctx: HttpContext) => Promise<unknown>).call(controller, ctx)
  }
}

function bindApi(
  getApi: () => ApiController | null,
  fn: (api: ApiController, ctx: HttpContext) => Promise<unknown> | unknown
) {
  return async (ctx: HttpContext) => {
    if (_whenReady) await _whenReady()
    const api = getApi()
    if (!api)
      return ctx.response.serviceUnavailable({
        error: 'Debug toolbar is starting up, please retry',
      })
    return fn(api, ctx)
  }
}

function registerDebugConfigRoutes(
  router: AdonisRouter,
  getDebugController: () => DebugController | null
) {
  router.get('/config', bindDebug(getDebugController, 'config')).as('server-stats.debug.config')
  router
    .get('/diagnostics', bindDebug(getDebugController, 'diagnostics'))
    .as('server-stats.debug.diagnostics')
}

function registerDebugQueryAndEventRoutes(
  router: AdonisRouter,
  getApiController: () => ApiController | null
) {
  router
    .get(
      '/queries',
      bindApi(getApiController, async (api, ctx) => {
        const queries = await api.getQueries({ source: 'memory' })
        return ctx.response.json({ queries: queries.data, summary: api.getQuerySummary() })
      })
    )
    .as('server-stats.debug.queries')
  router
    .get(
      '/events',
      bindApi(getApiController, async (api, ctx) => {
        const result = await api.getEvents({ source: 'memory' })
        return ctx.response.json({ events: result.data, total: result.meta.total })
      })
    )
    .as('server-stats.debug.events')
  router
    .get(
      '/routes',
      bindApi(getApiController, (api, ctx) => {
        const result = api.getRoutes()
        return ctx.response.json({ routes: result.data, total: result.meta.total })
      })
    )
    .as('server-stats.debug.routes')
}

function registerDebugLogRoutes(
  router: AdonisRouter,
  getApiController: () => ApiController | null
) {
  router
    .get(
      '/logs',
      bindApi(getApiController, async (api, ctx) => {
        const result = await api.getLogs({ source: 'auto', perPage: 200 })
        return ctx.response.json(result.data)
      })
    )
    .as('server-stats.debug.logs')
}

function registerDebugEmailRoutes(
  router: AdonisRouter,
  getApiController: () => ApiController | null
) {
  router
    .get(
      '/emails',
      bindApi(getApiController, async (api, ctx) => {
        const result = await api.getEmails({})
        return ctx.response.json({ emails: result.data, total: result.meta.total })
      })
    )
    .as('server-stats.debug.emails')
  router
    .get(
      '/emails/:id/preview',
      bindApi(getApiController, async (api, ctx) => {
        const html = await api.getEmailPreview(Number(ctx.params.id))
        if (!html) return ctx.response.notFound({ error: 'Email not found' })
        return ctx.response.header('Content-Type', 'text/html; charset=utf-8').send(html)
      })
    )
    .as('server-stats.debug.emailPreview')
}

function registerDebugTraceRoutes(
  router: AdonisRouter,
  getApiController: () => ApiController | null
) {
  router
    .get(
      '/traces',
      bindApi(getApiController, async (api, ctx) => {
        const result = await api.getTraces({ source: 'memory' })
        return ctx.response.json({ traces: result.data, total: result.meta.total })
      })
    )
    .as('server-stats.debug.traces')
  router
    .get(
      '/traces/:id',
      bindApi(getApiController, async (api, ctx) => {
        const trace = await api.getTraceDetail(Number(ctx.params.id), 'memory')
        if (!trace) return ctx.response.notFound({ error: 'Trace not found' })
        return ctx.response.json(trace)
      })
    )
    .as('server-stats.debug.traceDetail')
}

interface DebugRoutesOpts {
  router: AdonisRouter
  debugEndpoint: string
  getDebugController: () => DebugController | null
  getApiController: () => ApiController | null
  getDebugStore?: () => DebugStore | null
  getApp?: () => ApplicationService | null
  middleware: Array<(ctx: HttpContext, next: () => Promise<void>) => Promise<void>>
  whenReady?: () => Promise<void>
}

function registerDebugExplainRoute(
  router: AdonisRouter,
  getDebugStore?: () => DebugStore | null,
  getApp?: () => ApplicationService | null
) {
  if (!getDebugStore || !getApp) return
  router
    .get('/queries/:id/explain', async (ctx: HttpContext) => {
      if (_whenReady) await _whenReady()
      const store = getDebugStore()
      const app = getApp()
      if (!store || !app) {
        return ctx.response.serviceUnavailable({ error: 'Debug store not ready' })
      }
      const query = store.queries.getQueryById(Number(ctx.params.id))
      if (!query) return ctx.response.notFound({ error: 'Query not found' })
      if (!query.sql.trim().toUpperCase().startsWith('SELECT')) {
        return ctx.response.badRequest({ error: 'EXPLAIN is only supported for SELECT queries' })
      }
      try {
        const appDb = await getAppDbClient(app, query.connection || undefined)
        if (!appDb) {
          return ctx.response.serviceUnavailable({ error: 'App database connection not available' })
        }
        const bindings = Array.isArray(query.bindings) ? query.bindings : []
        const explainSql = buildExplainSql(query.sql, appDb.dialect)
        if (!explainSql) {
          return ctx.response.badRequest({
            error: `EXPLAIN is not supported for ${appDb.dialect} databases`,
          })
        }
        const explainResult = await appDb.raw(explainSql, bindings)
        const plan = extractPlan(explainResult, appDb.dialect)
        return ctx.response.json({ queryId: query.id, sql: query.sql, plan })
      } catch (error) {
        return ctx.response.internalServerError({
          error: 'EXPLAIN failed',
          message: (error as Error)?.message ?? 'Unknown error',
        })
      }
    })
    .as('server-stats.debug.queryExplain')
}

/** Register debug panel API routes. */
export function registerDebugRoutes(opts: DebugRoutesOpts) {
  const { router, debugEndpoint, getDebugController, getApiController, middleware } = opts
  if (opts.whenReady) _whenReady = opts.whenReady
  const base = debugEndpoint.replace(/\/+$/, '')

  router
    .group(() => {
      registerDebugConfigRoutes(router, getDebugController)
      registerDebugQueryAndEventRoutes(router, getApiController)
      registerDebugExplainRoute(router, opts.getDebugStore, opts.getApp)
      registerDebugLogRoutes(router, getApiController)
      registerDebugEmailRoutes(router, getApiController)
      registerDebugTraceRoutes(router, getApiController)
    })
    .prefix(base)
    .use(middleware)
}
