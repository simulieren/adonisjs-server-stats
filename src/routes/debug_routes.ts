import { createAccessMiddleware } from './access_middleware.js'

import type DebugController from '../controller/debug_controller.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { AdonisRouter } from './router_types.js'

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
  router: AdonisRouter,
  basePath: string,
  getController: () => DebugController | null,
  shouldShow?: (ctx: HttpContext) => boolean
) {
  const base = basePath.replace(/\/+$/, '')
  const middleware = shouldShow ? [createAccessMiddleware(shouldShow)] : []

  const bind = (method: keyof DebugController) => {
    return async (ctx: HttpContext) => {
      const controller = getController()
      if (!controller) {
        return ctx.response.serviceUnavailable({
          error: 'Debug toolbar is starting up, please retry',
        })
      }
      return (controller[method] as (ctx: HttpContext) => Promise<unknown>).call(controller, ctx)
    }
  }

  router
    .group(() => {
      // Non-data endpoints stay on DebugController
      router.get('/config', bind('config')).as('server-stats.debug.config')
      router.get('/diagnostics', bind('diagnostics')).as('server-stats.debug.diagnostics')

      // Note: data resource endpoints (queries, events, emails, traces,
      // routes, logs) are now handled by ApiController via register_routes.ts.
    })
    .prefix(base)
    .use(middleware)
}
