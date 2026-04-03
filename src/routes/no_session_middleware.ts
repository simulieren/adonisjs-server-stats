import type { HttpContext } from '@adonisjs/core/http'

/**
 * Middleware that strips `Set-Cookie` headers from the response.
 *
 * AdonisJS session middleware (when registered globally via `router.use()`)
 * issues a `Set-Cookie` on every request — even stateless API endpoints.
 * Because this package's routes are polled every few seconds, this causes
 * rapid cookie accumulation that can break the browser.
 *
 * This middleware runs after the route handler (and any global middleware)
 * and removes the `Set-Cookie` header so sessions are never started by
 * server-stats routes.
 */
export async function noSessionMiddleware(
  ctx: HttpContext,
  next: () => Promise<void>
): Promise<void> {
  await next()
  ctx.response.response.removeHeader('set-cookie')
}
