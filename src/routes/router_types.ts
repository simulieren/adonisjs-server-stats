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
 * Minimal interface for the AdonisJS router used in route registration.
 *
 * Covers every HTTP method and grouping pattern used by
 * `registerStatsRoutes`, `registerDebugRoutes`, and `registerDashboardRoutes`.
 */
export interface AdonisRouter {
  get(pattern: string, handler: (ctx: HttpContext) => unknown): AdonisRoute
  post(pattern: string, handler: (ctx: HttpContext) => unknown): AdonisRoute
  delete(pattern: string, handler: (ctx: HttpContext) => unknown): AdonisRoute
  group(callback: () => void): { prefix(path: string): { use(middleware: unknown[]): void } }
}
