import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'

import { getRequestMetrics } from '../collectors/http_collector.js'
import { log } from '../utils/logger.js'

import type { TraceCollector } from '../debug/trace_collector.js'
import type { TraceRecord } from '../debug/types.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/** Minimal interface for Edge.js view sharing on the HTTP context. */
interface EdgeViewShare {
  share(data: Record<string, unknown>): void
}

const excludedRequestAls = new AsyncLocalStorage<boolean>()

/** Returns true if the current async context is inside an excluded request. */
export function isExcludedRequest(): boolean {
  return excludedRequestAls.getStore() === true
}

let warnedShouldShow = false
let shouldShowFn: ((ctx: HttpContext) => boolean) | null = null

export function setShouldShow(fn: ((ctx: HttpContext) => boolean) | null) {
  shouldShowFn = fn
}

let traceCollector: TraceCollector | null = null

export function setTraceCollector(collector: TraceCollector | null) {
  traceCollector = collector
}

let dashboardPath: string | null = null

export function setDashboardPath(path: string | null) {
  dashboardPath = path
}

let excludedPrefixes: string[] = []

export function setExcludedPrefixes(prefixes: string[]) {
  excludedPrefixes = prefixes
}

/** Data passed to the onRequestComplete callback. */
export interface RequestCompleteData {
  method: string
  url: string
  statusCode: number
  duration: number
  trace?: TraceRecord
  httpRequestId?: string
}

let onRequestCompleteFn: ((data: RequestCompleteData) => void) | null = null

export function setOnRequestComplete(fn: ((data: RequestCompleteData) => void) | null) {
  onRequestCompleteFn = fn
}

/** Share a lazy shouldShow evaluator with Edge for @serverStats() tag. */
function shareShouldShowWithEdge(ctx: HttpContext): void {
  const ctxView = (ctx as unknown as { view?: EdgeViewShare }).view
  if (!shouldShowFn || typeof ctxView?.share !== 'function') return
  ctxView.share({
    __ssShowFn: () => {
      try {
        return shouldShowFn!(ctx)
      } catch (err) {
        if (!warnedShouldShow) {
          warnedShouldShow = true
          log.warn(
            'shouldShow callback threw — stats bar will be hidden: ' + (err as Error)?.message
          )
        }
        return false
      }
    },
  })
}

/** Record request metrics, finish trace, and fire the completion callback. */
function recordRequestCompletion(opts: {
  ctx: HttpContext
  start: number
  metrics: NonNullable<ReturnType<typeof getRequestMetrics>>
  skipTracing: boolean
}): void {
  const duration = performance.now() - opts.start
  opts.metrics.decrementActiveConnections()
  opts.metrics.recordRequest(duration, opts.ctx.response.getStatus())
  if (opts.skipTracing) return

  const reqId =
    typeof opts.ctx.request.id === 'function' ? String(opts.ctx.request.id()) : undefined
  const traceRecord = traceCollector?.finishTrace(
    opts.ctx.request.method(),
    opts.ctx.request.url(true),
    opts.ctx.response.getStatus(),
    reqId
  )
  onRequestCompleteFn?.({
    method: opts.ctx.request.method(),
    url: opts.ctx.request.url(true),
    statusCode: opts.ctx.response.getStatus(),
    duration,
    trace: traceRecord ?? undefined,
    httpRequestId: reqId,
  })
}

/** Build the inner request handler that calls next() and records completion. */
function buildRequestRunner(opts: {
  ctx: HttpContext
  next: NextFn
  start: number
  metrics: NonNullable<ReturnType<typeof getRequestMetrics>>
  skipTracing: boolean
}): () => Promise<void> {
  return async () => {
    try {
      await opts.next()
    } finally {
      recordRequestCompletion(opts)
    }
  }
}

/** Dispatch the request runner through tracing, ALS, or direct execution. */
async function dispatchRequest(
  runRequest: () => Promise<void>,
  skipTracing: boolean
): Promise<void> {
  if (traceCollector && !skipTracing) {
    await traceCollector.startTrace(runRequest)
  } else if (skipTracing) {
    await excludedRequestAls.run(true, runRequest)
  } else {
    await runRequest()
  }
}

export default class RequestTrackingMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const requestUrl = ctx.request.url(true)
    if (dashboardPath && requestUrl.startsWith(dashboardPath)) {
      await next()
      return
    }

    const metrics = getRequestMetrics()
    if (!metrics) {
      await next()
      return
    }

    const start = performance.now()
    metrics.incrementActiveConnections()
    shareShouldShowWithEdge(ctx)

    const skipTracing = excludedPrefixes.some((prefix) => requestUrl.startsWith(prefix))
    const runRequest = buildRequestRunner({ ctx, next, start, metrics, skipTracing })
    await dispatchRequest(runRequest, skipTracing)
  }
}
