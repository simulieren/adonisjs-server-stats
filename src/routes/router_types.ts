import type { HttpContext } from '@adonisjs/core/http'

/**
 * Minimal interface for an AdonisJS route returned by `router.get()` etc.
 *
 * Covers all chaining patterns used across stats, debug, and dashboard
 * route files: `.as()`, `.where()`, and `.use()`.
 */
export interface AdonisRoute {
  as(name: string): AdonisRoute
  where(key: string, matcher: RegExp): AdonisRoute
  use(middleware: unknown[]): void
}

/**
 * Return type of `router.group()` supporting the chaining patterns
 * used by server-stats route registration.
 *
 * AdonisJS allows chaining `.prefix()`, `.domain()`, and `.use()` in
 * any order on a route group. This interface covers the combinations
 * we use: `.prefix().use()`, `.prefix().domain().use()`, and
 * `.domain().prefix().use()`.
 */
export interface AdonisRouteGroup {
  prefix(path: string): AdonisRouteGroup
  domain(host: string): AdonisRouteGroup
  use(middleware: unknown[]): AdonisRouteGroup
}

/**
 * Minimal interface for the AdonisJS router used in route registration.
 *
 * Covers every HTTP method and grouping pattern used by
 * `registerStatsRoutes`, `registerDebugRoutes`, and `registerDashboardRoutes`.
 */
export interface AdonisRouter {
  get(pattern: string, handler: (ctx: HttpContext) => unknown): AdonisRoute
  post(pattern: string, handler: (ctx: HttpContext) => unknown): AdonisRoute
  delete(pattern: string, handler: (ctx: HttpContext) => unknown): AdonisRoute
  group(callback: () => void): AdonisRouteGroup
}
