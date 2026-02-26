import { RequestMetrics } from '../engine/request_metrics.js'
import { log } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

/**
 * Options for {@link httpCollector}.
 */
export interface HttpCollectorOptions {
  /**
   * Maximum number of request records to keep in the circular buffer.
   *
   * Older records are overwritten when the buffer is full. Higher values
   * give more accurate rate calculations but use more memory.
   *
   * @default 10_000
   */
  maxRecords?: number

  /**
   * Rolling time window (in **milliseconds**) used for rate calculations.
   *
   * Only requests within this window are counted for `requestsPerSecond`,
   * `avgResponseTimeMs`, and `errorRate`.
   *
   * @default 60_000 (60 seconds)
   */
  windowMs?: number
}

let sharedInstance: RequestMetrics | null = null

/**
 * Returns the shared {@link RequestMetrics} instance created by
 * `httpCollector()`.
 *
 * Useful for accessing request metrics outside of the collector
 * (e.g. in custom middleware or controllers).
 *
 * @throws If `httpCollector()` has not been included in the config.
 */
export function getRequestMetrics(): RequestMetrics {
  if (!sharedInstance) {
    throw new Error(
      'RequestMetrics not initialized. Ensure httpCollector() is included in your collectors config.'
    )
  }
  return sharedInstance
}

/**
 * Tracks HTTP request throughput, response times, and error rates.
 *
 * Works with the request tracking middleware, which calls
 * `RequestMetrics.recordRequest()` for every completed request.
 *
 * **Metrics produced:**
 * - `requestsPerSecond` -- requests per second over the rolling window
 * - `avgResponseTimeMs` -- average response time in ms
 * - `errorRate` -- percentage of 5xx responses
 * - `activeHttpConnections` -- currently open connections
 *
 * **Peer dependencies:** none
 *
 * @example
 * ```ts
 * import { httpCollector } from 'adonisjs-server-stats/collectors'
 *
 * httpCollector()                          // all defaults
 * httpCollector({ maxRecords: 50_000 })    // larger buffer
 * httpCollector({ windowMs: 30_000 })      // 30-second window
 * ```
 */
export function httpCollector(opts?: HttpCollectorOptions): MetricCollector {
  const metrics = new RequestMetrics(opts)
  sharedInstance = metrics

  return {
    name: 'http',

    collect() {
      try {
        const m = metrics.getMetrics()
        return {
          requestsPerSecond: m.requestsPerSecond,
          avgResponseTimeMs: m.averageResponseTimeMs,
          errorRate: m.errorRate,
          activeHttpConnections: m.activeConnections,
        }
      } catch (error) {
        log.warn(`http collector failed: ${(error as Error).message}`)
        return {
          requestsPerSecond: 0,
          avgResponseTimeMs: 0,
          errorRate: 0,
          activeHttpConnections: 0,
        }
      }
    },
  }
}
