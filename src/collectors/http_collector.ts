import { RequestMetrics } from '../engine/request_metrics.js'

import type { MetricCollector } from './collector.js'

export interface HttpCollectorOptions {
  maxRecords?: number
  windowMs?: number
}

let sharedInstance: RequestMetrics | null = null

export function getRequestMetrics(): RequestMetrics {
  if (!sharedInstance) {
    throw new Error(
      'RequestMetrics not initialized. Ensure httpCollector() is included in your collectors config.'
    )
  }
  return sharedInstance
}

export function httpCollector(opts?: HttpCollectorOptions): MetricCollector {
  const metrics = new RequestMetrics(opts)
  sharedInstance = metrics

  return {
    name: 'http',

    collect() {
      const m = metrics.getMetrics()
      return {
        requestsPerSecond: m.requestsPerSecond,
        avgResponseTimeMs: m.averageResponseTimeMs,
        errorRate: m.errorRate,
        activeHttpConnections: m.activeConnections,
      }
    },
  }
}
