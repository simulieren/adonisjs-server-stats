import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'

import { getRequestMetrics } from '../collectors/http_collector.js'
import { log } from '../utils/logger.js'

import type { TraceCollector } from '../debug/trace_collector.js'
import type { TraceRecord } from '../debug/types.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * AsyncLocalStorage that marks the current request as "excluded" from
 * debug collection. Checked by QueryCollector and EventCollector to
 * skip queries/events triggered by the debug panel's own polling.
 */
const excludedRequestAls = new AsyncLocalStorage<boolean>()

/**
 * Returns true if the current async context is inside an excluded request
 * (e.g. a debug panel polling request). Used by collectors to skip
 * self-generated data.
 */
export function isExcludedRequest(): boolean {
  return excludedRequestAls.getStore() === true
}

/**
 * Warn-once guard for shouldShow callback failures.
 */
let warnedShouldShow = false

/**
 * Module-level `shouldShow` callback, set by the provider at boot.
 */
let shouldShowFn: ((ctx: any) => boolean) | null = null

export function setShouldShow(fn: ((ctx: any) => boolean) | null) {
  shouldShowFn = fn
}

/**
 * Module-level trace collector, set by the provider when tracing is enabled.
 */
let traceCollector: TraceCollector | null = null

export function setTraceCollector(collector: TraceCollector | null) {
  traceCollector = collector
}

/**
 * Module-level dashboard path, set by the provider when dashboard is enabled.
 * Requests to this path (and sub-paths) are excluded from metrics and tracing.
 */
let dashboardPath: string | null = null

export function setDashboardPath(path: string | null) {
  dashboardPath = path
}

/**
 * Module-level list of URL prefixes to exclude from tracing and onRequestComplete.
 * Used to filter out the debug panel's own polling requests (e.g. /admin/api/debug/,
 * /admin/api/server-stats) so they don't flood the timeline.
 */
let excludedPrefixes: string[] = []

export function setExcludedPrefixes(prefixes: string[]) {
  excludedPrefixes = prefixes
}

/**
 * Data passed to the onRequestComplete callback.
 */
export interface RequestCompleteData {
  method: string
  url: string
  statusCode: number
  duration: number
  trace?: TraceRecord
}

/**
 * Module-level callback fired after each request completes.
 * Used by the provider to pipe request data to the DashboardStore.
 */
let onRequestCompleteFn: ((data: RequestCompleteData) => void) | null = null

export function setOnRequestComplete(fn: ((data: RequestCompleteData) => void) | null) {
  onRequestCompleteFn = fn
}

export default class RequestTrackingMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // Self-exclude: skip metrics and tracing for dashboard routes
    const requestUrl = ctx.request.url(true)
    if (dashboardPath && requestUrl.startsWith(dashboardPath)) {
      await next()
      return
    }

    const metrics = getRequestMetrics()
    const start = performance.now()
    metrics.incrementActiveConnections()

    // Share a lazy shouldShow evaluator with Edge for @serverStats() tag.
    // Must be lazy (a function, not a boolean) because this server middleware
    // runs BEFORE router middleware like initialize_auth_middleware and
    // silentAuth — so ctx.auth isn't populated yet. The function is called
    // at Edge render time (inside the controller), when auth is available.
    if (shouldShowFn && typeof (ctx as any).view?.share === 'function') {
      ;(ctx as any).view.share({
        __ssShowFn: () => {
          try {
            return shouldShowFn!(ctx)
          } catch (err) {
            if (!warnedShouldShow) {
              warnedShouldShow = true
              log.warn(
                'shouldShow callback threw — stats bar will be hidden: ' + (err as any)?.message
              )
            }
            return false
          }
        },
      })
    }

    // Skip tracing and dashboard persistence for the debug panel's own requests
    // (e.g. /admin/api/debug/*, /admin/api/server-stats) so they don't flood
    // the timeline. HTTP metrics (req/s, avg latency) are still recorded.
    const skipTracing =
      excludedPrefixes.some((prefix) => requestUrl.startsWith(prefix))

    const runRequest = async () => {
      try {
        await next()
      } finally {
        const duration = performance.now() - start
        metrics.decrementActiveConnections()
        metrics.recordRequest(duration, ctx.response.getStatus())

        if (!skipTracing) {
          const traceRecord = traceCollector?.finishTrace(
            ctx.request.method(),
            ctx.request.url(true),
            ctx.response.getStatus()
          )

          onRequestCompleteFn?.({
            method: ctx.request.method(),
            url: ctx.request.url(true),
            statusCode: ctx.response.getStatus(),
            duration,
            trace: traceRecord ?? undefined,
          })
        }
      }
    }

    if (traceCollector && !skipTracing) {
      await traceCollector.startTrace(runRequest)
    } else if (skipTracing) {
      // Run inside ALS so collectors can check isExcludedRequest()
      await excludedRequestAls.run(true, runRequest)
    } else {
      await runRequest()
    }
  }
}
