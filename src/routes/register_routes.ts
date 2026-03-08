import { registerStatsRoute } from './stats_routes.js'
import { registerDebugRoutes } from './debug_routes.js'
import { registerDashboardRoutes } from './dashboard_routes.js'
import { createAccessMiddleware } from './access_middleware.js'

import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { AdonisRouter } from './router_types.js'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Options for the unified route registration function.
 */
export interface RegisterRoutesOptions {
  router: AdonisRouter
  getApiController: () => ApiController | null
  getStatsController: () => ServerStatsController | null
  getDebugController: () => DebugController | null
  getDashboardController: () => DashboardController | null
  statsEndpoint?: string | false
  debugEndpoint?: string
  dashboardPath?: string
  shouldShow?: (ctx: HttpContext) => boolean
}

/**
 * Register all server-stats routes in a single call.
 */
export function registerAllRoutes(options: RegisterRoutesOptions): void {
  const middleware = options.shouldShow ? [createAccessMiddleware(options.shouldShow)] : []

  if (typeof options.statsEndpoint === 'string') {
    registerStatsRoute(options.router, options.statsEndpoint, options.getStatsController, middleware)
  }

  if (options.debugEndpoint) {
    registerDebugRoutes({
      router: options.router,
      debugEndpoint: options.debugEndpoint,
      getDebugController: options.getDebugController,
      getApiController: options.getApiController,
      middleware,
    })
  }

  if (options.dashboardPath) {
    registerDashboardRoutes({
      router: options.router,
      dashboardPath: options.dashboardPath,
      getDashboardController: options.getDashboardController,
      getApiController: options.getApiController,
      middleware,
    })
  }
}
