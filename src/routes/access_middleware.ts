import { log } from '../utils/logger.js'

import type { AccessGuard } from '../types.js'
import type { HttpContext } from '@adonisjs/core/http'

let warnedShouldShow = false

/**
 * Create a middleware function that gates access using the shouldShow callback.
 * Returns 403 if the callback returns false.
 *
 * The guard is awaited, so an async callback (the usual shape when it has to
 * consult `ctx.auth` or the database) is resolved before the decision is made.
 * Returning the promise unawaited would make every async guard pass, since a
 * pending promise is truthy.
 *
 * Shared by stats, debug, and dashboard route registrars.
 */
export function createAccessMiddleware(shouldShow: AccessGuard) {
  return async (ctx: HttpContext, next: () => Promise<void>) => {
    try {
      if (!(await shouldShow(ctx))) {
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
