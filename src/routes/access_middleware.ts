import { log } from '../utils/logger.js'

import type { HttpContext } from '@adonisjs/core/http'

let warnedShouldShow = false

/**
 * Create a middleware function that gates access using the shouldShow callback.
 * Returns 403 if the callback returns false.
 *
 * Shared by stats, debug, and dashboard route registrars.
 */
export function createAccessMiddleware(shouldShow: (ctx: HttpContext) => boolean) {
  return async (ctx: HttpContext, next: () => Promise<void>) => {
    try {
      if (!shouldShow(ctx)) {
        return ctx.response.forbidden({ error: 'Access denied' })
      }
    } catch (err) {
      if (!warnedShouldShow) {
        warnedShouldShow = true
        log.warn(
          'shouldShow callback threw in route guard — returning 403: ' + (err as Error)?.message
        )
      }
      return ctx.response.forbidden({ error: 'Access denied' })
    }
    await next()
  }
}
