import { round } from '../utils/math_helpers.js'
import { toSqliteTimestamp } from '../utils/time_helpers.js'

import type { Knex } from 'knex'

/** Context for building a metrics row. */
interface AggregationContext {
  trx: Knex.Transaction
  bucket: string
  cutoff: string
}

/** Fetch request stats (count, avg, errors) for the given cutoff. */
async function fetchRequestStats(ctx: AggregationContext) {
  const stats: Record<string, unknown> | undefined = await ctx
    .trx('server_stats_requests')
    .where('created_at', '>=', ctx.cutoff)
    .select(
      ctx.trx.raw('COUNT(*) as request_count'),
      ctx.trx.raw('ROUND(AVG(duration), 2) as avg_duration'),
      ctx.trx.raw('SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count')
    )
    .first()

  return {
    requestCount: Number(stats?.request_count ?? 0),
    avgDuration: stats?.avg_duration as number,
    errorCount: Number(stats?.error_count ?? 0),
  }
}

/** The empty-bucket row shape for minutes with no requests. */
const EMPTY_METRICS = {
  request_count: 0,
  avg_duration: 0,
  p95_duration: 0,
  error_count: 0,
  query_count: 0,
  avg_query_duration: 0,
} as const

/** Insert an empty metrics bucket (no requests in this minute). */
async function insertEmptyBucket(ctx: AggregationContext): Promise<void> {
  await ctx.trx('server_stats_metrics').insert({ bucket: ctx.bucket, ...EMPTY_METRICS })
}

/** Fetch p95 duration from the request table. */
async function fetchP95Duration(ctx: AggregationContext, requestCount: number): Promise<number> {
  const offset = Math.floor(requestCount * 0.95)
  const row = await ctx
    .trx('server_stats_requests')
    .where('created_at', '>=', ctx.cutoff)
    .orderBy('duration', 'asc')
    .offset(Math.min(offset, requestCount - 1))
    .limit(1)
    .select('duration')
    .first()
  return (row?.duration as number) ?? 0
}

/** Fetch query stats for the given cutoff. */
async function fetchQueryStats(ctx: AggregationContext) {
  const row: { query_count: number; avg_query_duration: number } | undefined = await ctx
    .trx('server_stats_queries')
    .where('created_at', '>=', ctx.cutoff)
    .select(
      ctx.trx.raw('COUNT(*) as query_count'),
      ctx.trx.raw('AVG(duration) as avg_query_duration')
    )
    .first()
  return { queryCount: row?.query_count ?? 0, avgQueryDuration: row?.avg_query_duration ?? 0 }
}

/** Insert a full metrics row with all computed values. */
async function insertFullBucket(
  ctx: AggregationContext,
  reqStats: { requestCount: number; avgDuration: number; errorCount: number }
): Promise<void> {
  const p95 = await fetchP95Duration(ctx, reqStats.requestCount)
  const qs = await fetchQueryStats(ctx)

  await ctx.trx('server_stats_metrics').insert({
    bucket: ctx.bucket,
    request_count: reqStats.requestCount,
    avg_duration: round(reqStats.avgDuration),
    p95_duration: round(p95),
    error_count: reqStats.errorCount,
    query_count: qs.queryCount,
    avg_query_duration: round(qs.avgQueryDuration),
  })
}

/**
 * Periodically aggregates recent request data into time-bucketed
 * metrics stored in `server_stats_metrics`.
 */
export class ChartAggregator {
  private db: Knex
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(db: Knex) {
    this.db = db
  }

  start(): void {
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
    await this.db.transaction(async (trx) => {
      const existing = await trx('server_stats_metrics').where('bucket', bucket).first()
      if (existing) return

      const cutoff = toSqliteTimestamp(new Date(Date.now() - 60_000))
      const ctx: AggregationContext = { trx, bucket, cutoff }
      const reqStats = await fetchRequestStats(ctx)

      if (reqStats.requestCount === 0) {
        await insertEmptyBucket(ctx)
        return
      }
      await insertFullBucket(ctx, reqStats)
    })
  }
}

/** Returns an ISO timestamp string rounded down to the current minute. */
function getBucketTimestamp(): string {
  const now = new Date()
  now.setSeconds(0, 0)
  return toSqliteTimestamp(now)
}
