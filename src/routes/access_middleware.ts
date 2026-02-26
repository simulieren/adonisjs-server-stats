/**
 * Create a middleware function that gates access using the shouldShow callback.
 * Returns 403 if the callback returns false.
 *
 * Shared by stats, debug, and dashboard route registrars.
 */
export function createAccessMiddleware(shouldShow: (ctx: any) => boolean) {
  return async (ctx: any, next: () => Promise<void>) => {
    try {
      if (!shouldShow(ctx)) {
        return ctx.response.forbidden({ error: 'Access denied' })
      }
    } catch {
      return ctx.response.forbidden({ error: 'Access denied' })
    }
    await next()
  }
}
