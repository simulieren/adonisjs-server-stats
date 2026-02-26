import { createAccessMiddleware } from './access_middleware.js'

import type ServerStatsController from '../controller/server_stats_controller.js'

/**
 * Register the stats bar API endpoint.
 *
 * Uses a lazy controller getter so the route can be registered during
 * `boot()` while the engine/controller is created during `ready()`.
 *
 * @param router      The AdonisJS router instance.
 * @param endpoint    The endpoint path (e.g. `/admin/api/server-stats`).
 * @param getController Lazy getter for the stats controller.
 * @param shouldShow  Optional access-control callback.
 */
export function registerStatsRoutes(
  router: any,
  endpoint: string,
  getController: () => ServerStatsController | null,
  shouldShow?: (ctx: any) => boolean
) {
  const middleware = shouldShow ? [createAccessMiddleware(shouldShow)] : []

  router
    .get(endpoint, async (ctx: any) => {
      const controller = getController()
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
