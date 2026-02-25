import type DashboardController from './dashboard_controller.js'

/**
 * Register all dashboard routes under the configured path.
 *
 * Uses closure-based handlers with a lazy controller getter so that
 * routes can be registered during `boot()` (before the router commits)
 * while the controller is created later during `ready()`.
 *
 * @param router         The AdonisJS router instance.
 * @param dashboardPath  The base path for the dashboard (e.g. `/__stats`).
 * @param getController  Lazy getter that returns the controller (or null if not ready).
 * @param shouldShow     Optional access-control callback; when set, all routes
 *                       are gated by it (returns 403 on denial).
 */
export function registerDashboardRoutes(
  router: any,
  dashboardPath: string,
  getController: () => DashboardController | null,
  shouldShow?: (ctx: any) => boolean
) {
  // Normalize: strip trailing slash
  const base = dashboardPath.replace(/\/+$/, '')

  // Helper to bind a controller method as a closure route handler.
  // Returns 503 if the controller isn't ready yet (server still booting).
  const bind = (method: keyof DashboardController) => {
    return async (ctx: any) => {
      const controller = getController()
      if (!controller) {
        return ctx.response.serviceUnavailable({ error: 'Dashboard is starting up, please retry' })
      }
      return (controller[method] as any).call(controller, ctx)
    }
  }

  const middleware = shouldShow ? [createAccessMiddleware(shouldShow)] : []

  router
    .group(() => {
      // Page
      router.get('/', bind('page')).as('server-stats.dashboard')

      // Overview
      router.get('/api/overview', bind('overview')).as('server-stats.overview')
      router.get('/api/overview/chart', bind('overviewChart')).as('server-stats.overview.chart')

      // Requests
      router.get('/api/requests', bind('requests')).as('server-stats.requests')
      router.get('/api/requests/:id', bind('requestDetail')).as('server-stats.requests.show')

      // Queries
      router.get('/api/queries', bind('queries')).as('server-stats.queries')
      router.get('/api/queries/grouped', bind('queriesGrouped')).as('server-stats.queries.grouped')
      router
        .get('/api/queries/:id/explain', bind('queryExplain'))
        .as('server-stats.queries.explain')

      // Events
      router.get('/api/events', bind('events')).as('server-stats.events')

      // Routes
      router.get('/api/routes', bind('routes')).as('server-stats.routes')

      // Logs
      router.get('/api/logs', bind('logs')).as('server-stats.logs')

      // Emails
      router.get('/api/emails', bind('emails')).as('server-stats.emails')
      router.get('/api/emails/:id/preview', bind('emailPreview')).as('server-stats.emails.preview')

      // Traces
      router.get('/api/traces', bind('traces')).as('server-stats.traces')
      router.get('/api/traces/:id', bind('traceDetail')).as('server-stats.traces.show')

      // Cache
      router.get('/api/cache', bind('cacheStats')).as('server-stats.cache')
      router
        .get('/api/cache/:key', bind('cacheKey'))
        .as('server-stats.cache.show')
        .where('key', /.*/)

      // Jobs / Queue
      router.get('/api/jobs', bind('jobs')).as('server-stats.jobs')
      router.get('/api/jobs/:id', bind('jobDetail')).as('server-stats.jobs.show')
      router.post('/api/jobs/:id/retry', bind('jobRetry')).as('server-stats.jobs.retry')

      // Config
      router.get('/api/config', bind('config')).as('server-stats.config')

      // Saved Filters
      router.get('/api/filters', bind('savedFilters')).as('server-stats.filters')
      router.post('/api/filters', bind('createSavedFilter')).as('server-stats.filters.create')
      router.delete('/api/filters/:id', bind('deleteSavedFilter')).as('server-stats.filters.delete')
    })
    .prefix(base)
    .use(middleware)
}

/**
 * Create a middleware function that gates access using the shouldShow callback.
 * Returns 403 if the callback returns false.
 */
function createAccessMiddleware(shouldShow: (ctx: any) => boolean) {
  return async (ctx: any, next: () => Promise<void>) => {
    try {
      if (!shouldShow(ctx)) {
        return ctx.response.forbidden({ error: 'Access denied' })
      }
    } catch {
      return ctx.response.forbidden({ error: 'Access denied' })
    }
    await next()
  }
}
