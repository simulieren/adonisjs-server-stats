import type { HttpContext } from '@adonisjs/core/http'

/**
 * Middleware that strips `Set-Cookie` headers from the response.
 *
 * AdonisJS session middleware (when registered globally via `router.use()`)
 * issues a `Set-Cookie` on every request — even stateless API endpoints.
 * Because this package's routes are polled every few seconds, this causes
 * rapid cookie accumulation that can break the browser.
 *
 * The `Set-Cookie` header is stripped **before** `next()` runs so it is gone
 * even when a downstream handler flushes headers early (e.g. a streaming/SSE
 * route under these prefixes) — stripping only after `next()` would be a no-op
 * once the response has already been flushed. It is stripped again after
 * `next()` to also cover cookies set by later global middleware on buffered
 * responses.
 */
export async function noSessionMiddleware(
  ctx: HttpContext,
  next: () => Promise<void>
): Promise<void> {
  ctx.response.response.removeHeader('set-cookie')
  await next()
  ctx.response.response.removeHeader('set-cookie')
}
