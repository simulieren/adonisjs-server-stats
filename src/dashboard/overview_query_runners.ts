/**
 * Database query runners for overview metrics and widget data.
 *
 * These functions execute the actual Knex queries within transactions.
 * Extracted from DashboardStore to reduce file length.
 */

import { round } from '../utils/math_helpers.js'
import { buildOverviewResult } from './overview_queries.js'

import type { Knex } from 'knex'

/**
 * Query aggregated overview metrics within a transaction.
 */
export async function queryOverviewMetrics(
  trx: Knex.Transaction,
  cutoff: string,
  range: string
): Promise<Record<string, unknown>> {
  const stats = await trx('server_stats_requests')
    .where('created_at', '>=', cutoff)
    .select(
      trx.raw('COUNT(*) as total'),
      trx.raw('ROUND(AVG(duration), 2) as avg_duration'),
      trx.raw('SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count')
    )
    .first()

  const total = Number(stats?.total ?? 0)

  const slowestEndpoints = await trx('server_stats_requests')
    .where('created_at', '>=', cutoff)
    .select('url', trx.raw('COUNT(*) as count'), trx.raw('ROUND(AVG(duration), 2) as avg_duration'))
    .groupBy('url')
    .orderBy('avg_duration', 'desc')
    .limit(5)

  const queryStats = await trx('server_stats_queries')
    .where('created_at', '>=', cutoff)
    .select(trx.raw('COUNT(*) as total'), trx.raw('ROUND(AVG(duration), 2) as avg_duration'))
    .first()

  const recentErrors = await trx('server_stats_logs')
    .where('created_at', '>=', cutoff)
    .whereIn('level', ['error', 'fatal'])
    .orderBy('created_at', 'desc')
    .limit(5)

  const result = buildOverviewResult(total, stats, range, slowestEndpoints, queryStats, recentErrors)

  if (total > 0) {
    const p95Offset = Math.floor(total * 0.95)
    const p95Row = await trx('server_stats_requests')
      .where('created_at', '>=', cutoff)
      .orderBy('duration', 'asc')
      .offset(Math.min(p95Offset, total - 1))
      .limit(1)
      .select('duration')
      .first()
    result.p95ResponseTime = round((p95Row?.duration as number) ?? 0)
  }

  return result
}

/**
 * Raw widget data shape returned by queryWidgetData.
 */
export interface WidgetDataRaw {
  topEventsRaw: Record<string, unknown>[]
  emailStatusRaw: Record<string, unknown>[]
  logLevelsRaw: Record<string, unknown>[]
  statusRaw: Record<string, unknown> | undefined
  slowQueriesRaw: Record<string, unknown>[]
}

/**
 * Query all widget data in a single transaction.
 */
export async function queryWidgetData(db: Knex, cutoff: string): Promise<WidgetDataRaw> {
  return db.transaction(async (trx) => ({
    topEventsRaw: await trx('server_stats_events')
      .select('event_name', trx.raw('COUNT(*) as count'))
      .where('created_at', '>=', cutoff)
      .groupBy('event_name')
      .orderBy('count', 'desc')
      .limit(5),

    emailStatusRaw: await trx('server_stats_emails')
      .select('status', trx.raw('COUNT(*) as count'))
      .where('created_at', '>=', cutoff)
      .groupBy('status'),

    logLevelsRaw: await trx('server_stats_logs')
      .select('level', trx.raw('COUNT(*) as count'))
      .where('created_at', '>=', cutoff)
      .groupBy('level'),

    statusRaw: await trx('server_stats_requests')
      .select(
        trx.raw(`SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as "s2xx"`),
        trx.raw(`SUM(CASE WHEN status_code >= 300 AND status_code < 400 THEN 1 ELSE 0 END) as "s3xx"`),
        trx.raw(`SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) as "s4xx"`),
        trx.raw(`SUM(CASE WHEN status_code >= 500 AND status_code < 600 THEN 1 ELSE 0 END) as "s5xx"`)
      )
      .where('created_at', '>=', cutoff)
      .first(),

    slowQueriesRaw: await trx('server_stats_queries')
      .select(
        'sql_normalized',
        trx.raw('ROUND(AVG(duration), 2) as avg_duration'),
        trx.raw('COUNT(*) as count')
      )
      .where('created_at', '>=', cutoff)
      .groupBy('sql_normalized')
      .orderBy('avg_duration', 'desc')
      .limit(5),
  }))
}
