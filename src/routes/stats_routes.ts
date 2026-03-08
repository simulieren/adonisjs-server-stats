import type ServerStatsController from '../controller/server_stats_controller.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'

/** Register the stats polling endpoint. */
export function registerStatsRoute(
  router: AdonisRouter,
  endpoint: string,
  getController: () => ServerStatsController | null,
  middleware: Array<(ctx: HttpContext, next: () => Promise<void>) => Promise<void>>
) {
  router
    .get(endpoint, async (ctx: HttpContext) => {
      const controller = getController()
      if (!controller)
        return ctx.response.serviceUnavailable({
          error: 'Stats engine is starting up, please retry',
        })
      return controller.index(ctx)
    })
    .as('server-stats.api')
    .use(middleware)
}
