import { createAccessMiddleware } from './access_middleware.js'

import type DebugController from '../controller/debug_controller.js'

/**
 * Register all debug toolbar API routes under the given base path.
 *
 * Uses a lazy controller getter so routes can be registered during
 * `boot()` while the DebugStore/controller is created during `ready()`.
 *
 * @param router        The AdonisJS router instance.
 * @param basePath      The base path (e.g. `/admin/api/debug`).
 * @param getController Lazy getter for the debug controller.
 * @param shouldShow    Optional access-control callback.
 */
export function registerDebugRoutes(
  router: any,
  basePath: string,
  getController: () => DebugController | null,
  shouldShow?: (ctx: any) => boolean
) {
  const base = basePath.replace(/\/+$/, '')
  const middleware = shouldShow ? [createAccessMiddleware(shouldShow)] : []

  const bind = (method: keyof DebugController) => {
    return async (ctx: any) => {
      const controller = getController()
      if (!controller) {
        return ctx.response.serviceUnavailable({
          error: 'Debug toolbar is starting up, please retry',
        })
      }
      return (controller[method] as any).call(controller, ctx)
    }
  }

  router
    .group(() => {
      router.get('/config', bind('config')).as('server-stats.debug.config')
      router.get('/queries', bind('queries')).as('server-stats.debug.queries')
      router.get('/events', bind('events')).as('server-stats.debug.events')
      router.get('/routes', bind('routes')).as('server-stats.debug.routes')
      router.get('/logs', bind('logs')).as('server-stats.debug.logs')
      router.get('/emails', bind('emails')).as('server-stats.debug.emails')
      router.get('/emails/:id/preview', bind('emailPreview')).as('server-stats.debug.emailPreview')
      router.get('/traces', bind('traces')).as('server-stats.debug.traces')
      router.get('/traces/:id', bind('traceDetail')).as('server-stats.debug.traceDetail')
    })
    .prefix(base)
    .use(middleware)
}
