/**
 * Pure data-mapping helpers for dashboard overview and chart queries.
 *
 * These functions transform raw database rows into the shapes
 * expected by the dashboard API. No I/O — just mapping and math.
 */

import { round } from '../utils/math_helpers.js'
import { rangeToMinutes, roundBucket } from '../utils/time_helpers.js'

// ---------------------------------------------------------------------------
// Overview metrics builder
// ---------------------------------------------------------------------------

/**
 * Build the overview metrics response from raw aggregated data.
 * Pure function — no database access.
 */
interface OverviewInput {
  total: number
  stats: Record<string, unknown> | null | undefined
  range: string
  slowestEndpoints: Record<string, unknown>[]
  queryStats: Record<string, unknown> | null | undefined
  recentErrors: Record<string, unknown>[]
}

const EMPTY_OVERVIEW = {
  avgResponseTime: 0,
  p95ResponseTime: 0,
  requestsPerMinute: 0,
  errorRate: 0,
  totalRequests: 0,
  slowestEndpoints: [],
  queryStats: { total: 0, avgDuration: 0, perRequest: 0 },
  recentErrors: [],
}

function mapQueryStats(queryStats: Record<string, unknown> | null | undefined, total: number) {
  const qTotal = (queryStats?.total as number) ?? 0
  return {
    total: qTotal,
    avgDuration: (queryStats?.avg_duration as number) ?? 0,
    perRequest: total > 0 ? round(qTotal / total) : 0,
  }
}

export function buildOverviewResult(input: OverviewInput): Record<string, unknown> {
  const { total, stats, range, slowestEndpoints, queryStats, recentErrors } = input
  if (total === 0) return EMPTY_OVERVIEW

  const errorCount = Number(stats?.error_count ?? 0)
  return {
    avgResponseTime: round((stats?.avg_duration as number) ?? 0),
    p95ResponseTime: 0,
    requestsPerMinute: round(total / rangeToMinutes(range)),
    errorRate: round((errorCount / total) * 100),
    totalRequests: total,
    slowestEndpoints: slowestEndpoints.map((s) => ({
      url: s.url,
      count: s.count,
      avgDuration: s.avg_duration,
    })),
    queryStats: mapQueryStats(queryStats, total),
    recentErrors: recentErrors.map((e) => ({
      id: e.id,
      message: e.message,
      createdAt: e.created_at,
    })),
  }
}

// ---------------------------------------------------------------------------
// Widget data mappers
// ---------------------------------------------------------------------------

/**
 * Map raw top events rows to the widget shape.
 */
export function mapTopEvents(
  raw: Record<string, unknown>[] | null | undefined
): { eventName: string; count: number }[] {
  return (raw || []).map((r) => ({
    eventName: r.event_name as string,
    count: r.count as number,
  }))
}

/**
 * Aggregate email status rows into sent/queued/failed counts.
 */
export function mapEmailActivity(raw: Record<string, unknown>[] | null | undefined): {
  sent: number
  queued: number
  failed: number
} {
  const activity = { sent: 0, queued: 0, failed: 0 }
  for (const row of raw || []) {
    const status = row.status as string
    const count = row.count as number
    if (status === 'sent' || status === 'sending') activity.sent += count
    else if (status === 'queued' || status === 'queueing') activity.queued += count
    else if (status === 'failed') activity.failed = count
  }
  return activity
}

/**
 * Map log level rows to the breakdown shape.
 */
export function mapLogLevelBreakdown(raw: Record<string, unknown>[] | null | undefined): {
  error: number
  warn: number
  info: number
  debug: number
} {
  const breakdown = { error: 0, warn: 0, info: 0, debug: 0 }
  for (const row of raw || []) {
    const level = row.level as string
    if (level in breakdown) {
      breakdown[level as keyof typeof breakdown] = row.count as number
    }
  }
  return breakdown
}

/**
 * Map status distribution row to the widget shape.
 */
export function mapStatusDistribution(row: Record<string, unknown> | null | undefined): {
  '2xx': number
  '3xx': number
  '4xx': number
  '5xx': number
} {
  return {
    '2xx': (row?.s2xx as number) ?? 0,
    '3xx': (row?.s3xx as number) ?? 0,
    '4xx': (row?.s4xx as number) ?? 0,
    '5xx': (row?.s5xx as number) ?? 0,
  }
}

/**
 * Map slowest query rows to the widget shape.
 */
export function mapSlowestQueries(
  raw: Record<string, unknown>[] | null | undefined
): { sqlNormalized: string; avgDuration: number; count: number }[] {
  return (raw || []).map((r) => ({
    sqlNormalized: r.sql_normalized as string,
    avgDuration: r.avg_duration as number,
    count: r.count as number,
  }))
}

// ---------------------------------------------------------------------------
// Chart data aggregation
// ---------------------------------------------------------------------------

interface MetricsBucket {
  bucket: string
  request_count: number
  avg_duration: number
  p95_duration: number
  error_count: number
  query_count: number
  avg_query_duration: number
  _count: number
}

/**
 * Aggregate per-minute metrics into larger buckets for 24h/7d ranges.
 * For 1h/6h, rows are returned as-is.
 */
export function aggregateChartBuckets(
  rows: Record<string, unknown>[],
  range: string
): Record<string, unknown>[] {
  if (range === '1h' || range === '6h') return rows

  const bucketMinutes = range === '7d' ? 60 : 15
  const grouped = new Map<string, MetricsBucket>()

  for (const row of rows) {
    const bucketKey = roundBucket(row.bucket as string, bucketMinutes)
    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, {
        bucket: bucketKey,
        request_count: 0,
        avg_duration: 0,
        p95_duration: 0,
        error_count: 0,
        query_count: 0,
        avg_query_duration: 0,
        _count: 0,
      })
    }
    const g = grouped.get(bucketKey)!
    g.request_count += row.request_count as number
    g.error_count += row.error_count as number
    g.query_count += row.query_count as number
    g.avg_duration += row.avg_duration as number
    g.p95_duration = Math.max(g.p95_duration, row.p95_duration as number)
    g.avg_query_duration += row.avg_query_duration as number
    g._count++
  }

  return Array.from(grouped.values()).map((g) => ({
    bucket: g.bucket,
    request_count: g.request_count,
    avg_duration: g._count > 0 ? round(g.avg_duration / g._count) : 0,
    p95_duration: round(g.p95_duration),
    error_count: g.error_count,
    query_count: g.query_count,
    avg_query_duration: g._count > 0 ? round(g.avg_query_duration / g._count) : 0,
  }))
}
