import { round } from '../utils/math_helpers.js'
import { toSqliteTimestamp } from '../utils/time_helpers.js'

import type { Knex } from 'knex'

/**
 * Periodically aggregates recent request data into time-bucketed
 * metrics stored in `server_stats_metrics`.
 *
 * Runs every 60 seconds. Each tick:
 * 1. Counts requests in the last minute
 * 2. Calculates avg/p95 response time
 * 3. Counts errors (4xx + 5xx)
 * 4. Counts queries and average query duration
 * 5. Stores a row with a bucket timestamp rounded to the minute
 */
export class ChartAggregator {
  private db: Knex
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(db: Knex) {
    this.db = db
  }

  start(): void {
    // Run immediately on startup, then every 60s
    this.aggregate().catch(() => {})
    this.timer = setInterval(() => {
      this.aggregate().catch(() => {})
    }, 60_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async aggregate(): Promise<void> {
    const bucket = getBucketTimestamp()

    // Check if we already have a row for this bucket (idempotent)
    const existing = await this.db('server_stats_metrics').where('bucket', bucket).first()

    if (existing) return

    // Get requests from the last 60 seconds
    const cutoff = toSqliteTimestamp(new Date(Date.now() - 60_000))

    const requests: { duration: number; status_code: number }[] = await this.db(
      'server_stats_requests'
    )
      .where('created_at', '>=', cutoff)
      .select('duration', 'status_code')

    const requestCount = requests.length
    if (requestCount === 0) {
      // Still insert a zero-row so the chart shows continuous data
      await this.db('server_stats_metrics').insert({
        bucket,
        request_count: 0,
        avg_duration: 0,
        p95_duration: 0,
        error_count: 0,
        query_count: 0,
        avg_query_duration: 0,
      })
      return
    }

    // Calculate avg and p95 duration
    const durations = requests.map((r) => r.duration).sort((a: number, b: number) => a - b)
    const avgDuration = durations.reduce((sum: number, d: number) => sum + d, 0) / requestCount
    const p95Index = Math.floor(requestCount * 0.95)
    const p95Duration = durations[Math.min(p95Index, requestCount - 1)]

    // Count errors (status >= 400)
    const errorCount = requests.filter((r) => r.status_code >= 400).length

    // Get query stats for the same window
    const queryStats: { query_count: number; avg_query_duration: number } | undefined =
      await this.db('server_stats_queries')
        .where('created_at', '>=', cutoff)
        .select(
          this.db.raw('COUNT(*) as query_count'),
          this.db.raw('AVG(duration) as avg_query_duration')
        )
        .first()

    await this.db('server_stats_metrics').insert({
      bucket,
      request_count: requestCount,
      avg_duration: round(avgDuration),
      p95_duration: round(p95Duration),
      error_count: errorCount,
      query_count: queryStats?.query_count ?? 0,
      avg_query_duration: round(queryStats?.avg_query_duration ?? 0),
    })
  }
}

/**
 * Returns an ISO timestamp string rounded down to the current minute.
 * Used as the bucket key for metrics aggregation.
 */
function getBucketTimestamp(): string {
  const now = new Date()
  now.setSeconds(0, 0)
  return toSqliteTimestamp(now)
}
