// ---------------------------------------------------------------------------
// Dashboard-specific types
// ---------------------------------------------------------------------------

/**
 * Aggregated overview metrics returned by the dashboard overview endpoint.
 */
export interface OverviewMetrics {
  avgResponseTime: number
  p95ResponseTime: number
  requestsPerMinute: number
  errorRate: number
  totalRequests: number
  slowestEndpoints: { url?: string; pattern?: string; avgDuration: number; count: number }[]
  queryStats: { total: number; avgDuration: number; perRequest: number }
  recentErrors: { id?: number; level: string; message: string; timestamp?: number | string }[]
  topEvents: {
    eventName?: string
    name?: string
    event_name?: string
    event?: string
    count: number
  }[]
  emailActivity: { sent: number; queued: number; failed: number }
  logLevelBreakdown: { error: number; warn: number; info: number; debug: number }
  cacheStats: {
    available: boolean
    totalKeys: number
    hitRate: number
    memoryUsedHuman: string
  } | null
  jobQueueStatus: {
    available: boolean
    active: number
    waiting: number
    failed: number
    completed: number
  } | null
  statusDistribution: { '2xx': number; '3xx': number; '4xx': number; '5xx': number }
  slowestQueries: {
    sqlNormalized?: string
    normalizedSql?: string
    sql_normalized?: string
    sql?: string
    avgDuration: number
    count: number
  }[]
  sparklines?: {
    avgResponseTime?: number[]
    p95ResponseTime?: number[]
    requestsPerMinute?: number[]
    errorRate?: number[]
  }
}

/**
 * Extended overview data used by Vue dashboard components.
 * Extends {@link OverviewMetrics} with sparkline time-series data.
 */
export interface OverviewData extends OverviewMetrics {
  avgResponseTimeSeries?: number[]
  p95ResponseTimeSeries?: number[]
  requestsPerMinuteSeries?: number[]
  errorRateSeries?: number[]
  recentErrors: {
    id?: number
    level: string
    message: string
    timestamp: number | string
  }[]
}

/** Single data point for dashboard time-series charts. */
export interface ChartDataPoint {
  bucket: string
  total: number
  count2xx: number
  count3xx: number
  count4xx: number
  count5xx: number
  requestCount?: number
  errorCount?: number
  avgDuration?: number
  p95Duration?: number
}

/** A grouped/aggregated query pattern for the dashboard queries section. */
export interface GroupedQuery {
  pattern: string
  count: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  totalDuration: number
  percentOfTotal: number
}

// ---------------------------------------------------------------------------
// Cache types (dashboard)
// ---------------------------------------------------------------------------

/** Redis / cache store statistics returned by the dashboard cache endpoint. */
export interface DashboardCacheStats {
  connected: boolean
  hits: number
  misses: number
  hitRate: number
  memoryUsedBytes: number
  memoryUsedHuman: string
  connectedClients: number
  totalKeys: number
  keyCount?: number
}

/** Individual cache key entry in the dashboard cache inspector. */
export interface DashboardCacheKeyEntry {
  key: string
  type: string
  ttl: number
  size?: number | null
}

/** Full response from the dashboard cache API endpoint. */
export interface DashboardCacheResponse {
  available: boolean
  stats: DashboardCacheStats | null
  keys?: DashboardCacheKeyEntry[]
  data?: DashboardCacheKeyEntry[]
  cursor: string
}

// ---------------------------------------------------------------------------
// Job / queue types
// ---------------------------------------------------------------------------

/**
 * Server response shape from the dashboard API `/api/jobs` endpoint.
 */
export interface JobsApiResponse {
  available?: boolean
  overview?: JobStats
  stats?: JobStats
  data?: JobRecord[]
  jobs?: JobRecord[]
  total?: number
}

/** Aggregate queue statistics. */
export interface JobStats {
  active: number
  waiting: number
  delayed: number
  completed: number
  failed: number
}

/** Individual job record from the queue inspector. */
export interface JobRecord {
  id: string
  name: string
  status: string
  data: unknown
  payload: unknown
  attempts: number
  duration: number | null
  timestamp: number | string
  createdAt: number | string
  processedAt: number | string | null
  finishedAt: number | string | null
  failedReason: string | null
}
