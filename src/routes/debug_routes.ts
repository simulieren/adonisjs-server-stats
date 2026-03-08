import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'

/** Bind a debug controller method with lazy init and 503 fallback. */
function bindDebug(getController: () => DebugController | null, method: keyof DebugController) {
  return async (ctx: HttpContext) => {
    const controller = getController()
    if (!controller) return ctx.response.serviceUnavailable({ error: 'Debug toolbar is starting up, please retry' })
    return (controller[method] as (ctx: HttpContext) => Promise<unknown>).call(controller, ctx)
  }
}

/** Wrap an ApiController method as an HTTP handler with lazy init. */
function bindApi(getApi: () => ApiController | null, fn: (api: ApiController, ctx: HttpContext) => Promise<unknown> | unknown) {
  return async (ctx: HttpContext) => {
    const api = getApi()
    if (!api) return ctx.response.serviceUnavailable({ error: 'Debug toolbar is starting up, please retry' })
    return fn(api, ctx)
  }
}

/** Register debug panel API routes. */
export function registerDebugRoutes(
  router: AdonisRouter,
  debugEndpoint: string,
  getDebugController: () => DebugController | null,
  getApiController: () => ApiController | null,
  middleware: Array<(ctx: HttpContext, next: () => Promise<void>) => Promise<void>>
) {
  const base = debugEndpoint.replace(/\/+$/, '')

  router
    .group(() => {
      router.get('/config', bindDebug(getDebugController, 'config')).as('server-stats.debug.config')
      router.get('/diagnostics', bindDebug(getDebugController, 'diagnostics')).as('server-stats.debug.diagnostics')
      router.get('/queries', bindApi(getApiController, async (api, ctx) => {
        const queries = await api.getQueries({ source: 'memory' })
        return ctx.response.json({ queries: queries.data, summary: api.getQuerySummary() })
      })).as('server-stats.debug.queries')
      router.get('/events', bindApi(getApiController, async (api, ctx) => {
        const result = await api.getEvents({ source: 'memory' })
        return ctx.response.json({ events: result.data, total: result.meta.total })
      })).as('server-stats.debug.events')
      router.get('/routes', bindApi(getApiController, (api, ctx) => {
        const result = api.getRoutes()
        return ctx.response.json({ routes: result.data, total: result.meta.total })
      })).as('server-stats.debug.routes')
      router.get('/logs', bindApi(getApiController, async (api, ctx) => {
        const result = await api.getLogs({ source: 'auto', perPage: 200 })
        return ctx.response.json(result.data)
      })).as('server-stats.debug.logs')
      router.get('/emails', bindApi(getApiController, async (api, ctx) => {
        const result = await api.getEmails({})
        return ctx.response.json({ emails: result.data, total: result.meta.total })
      })).as('server-stats.debug.emails')
      router.get('/emails/:id/preview', bindApi(getApiController, async (api, ctx) => {
        const html = await api.getEmailPreview(Number(ctx.params.id))
        if (!html) return ctx.response.notFound({ error: 'Email not found' })
        return ctx.response.header('Content-Type', 'text/html; charset=utf-8').send(html)
      })).as('server-stats.debug.emailPreview')
      router.get('/traces', bindApi(getApiController, async (api, ctx) => {
        const result = await api.getTraces({ source: 'memory' })
        return ctx.response.json({ traces: result.data, total: result.meta.total })
      })).as('server-stats.debug.traces')
      router.get('/traces/:id', bindApi(getApiController, async (api, ctx) => {
        const trace = await api.getTraceDetail(Number(ctx.params.id), 'memory')
        if (!trace) return ctx.response.notFound({ error: 'Trace not found' })
        return ctx.response.json(trace)
      })).as('server-stats.debug.traceDetail')
    })
    .prefix(base)
    .use(middleware)
}
