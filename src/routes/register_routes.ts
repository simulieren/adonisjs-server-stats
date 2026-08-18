import { createAccessMiddleware } from './access_middleware.js'
import { registerDashboardRoutes } from './dashboard_routes.js'
import { registerDebugRoutes } from './debug_routes.js'
import { noSessionMiddleware } from './no_session_middleware.js'
import { registerStatsRoute } from './stats_routes.js'
import { log } from '../utils/logger.js'

import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type { DebugStore } from '../debug/debug_store.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { AccessGuard } from '../types.js'
import type { AdonisRouter } from './router_types.js'
import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Options for the unified route registration function.
 */
export interface RegisterRoutesOptions {
  router: AdonisRouter
  getApiController: () => ApiController | null
  getStatsController: () => ServerStatsController | null
  getDebugController: () => DebugController | null
  getDashboardController: () => DashboardController | null
  getDebugStore?: () => DebugStore | null
  getApp?: () => ApplicationService | null
  statsEndpoint?: string | false
  debugEndpoint?: string
  dashboardPath?: string
  shouldShow?: AccessGuard
  /**
   * Escape hatch to register the sensitive dashboard/debug/stats routes WITHOUT
   * any access guard when no `shouldShow` callback is provided. Off by default —
   * without either `shouldShow` or this flag, sensitive routes are NOT registered
   * (fail closed). Enabling this exposes the dashboard (which can surface secrets,
   * email bodies, and SQL) to anyone who can reach it. Local dev only.
   */
  unsafeAllowNoAuth?: boolean
  /**
   * Whether the app is running in production. When true, `unsafeAllowNoAuth` is
   * ignored — an unauthenticated dashboard in production is never correct, so
   * the only way in is a real `shouldShow` guard.
   */
  inProduction?: boolean
  /** Optional promise that resolves when controllers are initialized. */
  whenReady?: () => Promise<void>
  /**
   * Restrict every registered route to this host, via `router.group().domain()`.
   * Supports dynamic segments (`':tenant.example.com'`). Unset = no restriction.
   */
  domain?: string
}

/** One-time warning latch for the unsafeAllowNoAuth escape hatch. */
let _warnedNoAuth = false

/**
 * Register all server-stats routes in a single call.
 *
 * Returns whether the routes were actually registered — false means the
 * fail-closed guard check rejected the configuration, which callers need to
 * know before announcing that anything is reachable.
 */
export function registerAllRoutes(options: RegisterRoutesOptions): boolean {
  // Fail closed: without an access guard (`shouldShow`) the sensitive routes must
  // not be registered unless the caller explicitly opts in via `unsafeAllowNoAuth`.
  if (!options.shouldShow) {
    // In production the escape hatch does not apply — there is no legitimate
    // reason to serve secrets, email bodies, and SQL to unauthenticated callers
    // on a production host, so the guard is the only way through.
    if (options.inProduction) {
      log.warn(
        'server-stats: production mode is enabled but no `authorize`/`shouldShow` guard is ' +
          'configured — sensitive routes (dashboard, debug API, stats) will NOT be registered. ' +
          '`unsafeAllowNoAuth` is ignored in production. Provide an authorize callback.'
      )
      return false
    }
    if (!options.unsafeAllowNoAuth) {
      log.warn(
        'server-stats: no `authorize`/`shouldShow` guard configured — sensitive routes ' +
          '(dashboard, debug API, stats) will NOT be registered. Provide an authorize callback, ' +
          'or set `unsafeAllowNoAuth: true` to expose them without auth (local dev only).'
      )
      return false
    }
    if (!_warnedNoAuth) {
      _warnedNoAuth = true
      log.warn(
        'server-stats: `unsafeAllowNoAuth` is enabled — the dashboard is exposed WITHOUT ' +
          'authentication. It can surface secrets, email bodies, and SQL to anyone who can ' +
          'reach it. Do not use this outside strictly local development.'
      )
    }
  }

  const middleware = [
    noSessionMiddleware,
    ...(options.shouldShow ? [createAccessMiddleware(options.shouldShow)] : []),
  ]

  if (typeof options.statsEndpoint === 'string') {
    registerStatsRoute({
      router: options.router,
      endpoint: options.statsEndpoint,
      getController: options.getStatsController,
      middleware,
      domain: options.domain,
    })
  }

  if (options.debugEndpoint) {
    registerDebugRoutes({
      router: options.router,
      debugEndpoint: options.debugEndpoint,
      getDebugController: options.getDebugController,
      getApiController: options.getApiController,
      getDebugStore: options.getDebugStore,
      getApp: options.getApp,
      middleware,
      whenReady: options.whenReady,
      domain: options.domain,
    })
  }

  if (options.dashboardPath) {
    registerDashboardRoutes({
      router: options.router,
      dashboardPath: options.dashboardPath,
      getDashboardController: options.getDashboardController,
      getApiController: options.getApiController,
      middleware,
      whenReady: options.whenReady,
      domain: options.domain,
    })
  }

  return true
}
