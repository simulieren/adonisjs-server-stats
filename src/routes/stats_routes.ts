import type ServerStatsController from '../controller/server_stats_controller.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'

interface StatsRouteOpts {
  router: AdonisRouter
  endpoint: string
  getController: () => ServerStatsController | null
  middleware: Array<(ctx: HttpContext, next: () => Promise<void>) => Promise<void>>
  /** Optional domain restriction — see `ServerStatsConfig['domain']`. */
  domain?: string
}

/** Register the stats polling endpoint. */
export function registerStatsRoute(opts: StatsRouteOpts) {
  const { router, endpoint, getController, middleware, domain } = opts

  const register = () =>
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

  // A domain restriction needs a group to hang `.domain()` on; without one we
  // register the route directly so the route tree stays exactly as before.
  if (domain) router.group(register).domain(domain)
  else register()
}
