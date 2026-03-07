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
    // Defer the first aggregation so the event loop stays responsive
    // during dashboard initialization. Then run every 60s.
    setTimeout(() => this.aggregate().catch(() => {}), 2_000)
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

    // Aggregate request stats in SQL — avoids loading all rows into JS
    const cutoff = toSqliteTimestamp(new Date(Date.now() - 60_000))

    const stats: Record<string, unknown> | undefined = await this.db('server_stats_requests')
      .where('created_at', '>=', cutoff)
      .select(
        this.db.raw('COUNT(*) as request_count'),
        this.db.raw('ROUND(AVG(duration), 2) as avg_duration'),
        this.db.raw('SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count')
      )
      .first()

    const requestCount = Number(stats?.request_count ?? 0)

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

    // p95 via ORDER BY + OFFSET — avoids loading all rows
    const p95Offset = Math.floor(requestCount * 0.95)
    const p95Row = await this.db('server_stats_requests')
      .where('created_at', '>=', cutoff)
      .orderBy('duration', 'asc')
      .offset(Math.min(p95Offset, requestCount - 1))
      .limit(1)
      .select('duration')
      .first()

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
      avg_duration: round(stats?.avg_duration as number),
      p95_duration: round((p95Row?.duration as number) ?? 0),
      error_count: Number(stats?.error_count ?? 0),
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
