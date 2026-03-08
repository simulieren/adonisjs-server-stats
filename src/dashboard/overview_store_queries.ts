/**
 * Overview, chart, widget, and sparkline queries for the DashboardStore.
 *
 * Extracted from DashboardStore to reduce file length.
 * All functions take a Knex instance and CoalesceCache as parameters.
 */

import { log } from '../utils/logger.js'
import { rangeToCutoff } from '../utils/time_helpers.js'
import { CoalesceCache } from './coalesce_cache.js'
import {
  mapTopEvents,
  mapEmailActivity,
  mapLogLevelBreakdown,
  mapStatusDistribution,
  mapSlowestQueries,
  aggregateChartBuckets,
} from './overview_queries.js'
import { queryOverviewMetrics, queryWidgetData } from './overview_query_runners.js'

import type { Knex } from 'knex'

const WIDGETS_TTL = 2_000
const SPARKLINE_TTL = 5_000
const CHART_TTL = 5_000

let overviewWidgetWarned = false

// ---------------------------------------------------------------------------
// Overview metrics
// ---------------------------------------------------------------------------

export function fetchOverviewMetrics(
  db: Knex,
  cache: CoalesceCache,
  range: string
): Promise<Record<string, unknown> | null> {
  return cache.cached('overviewMetrics:' + range, 2_000, () =>
    db.transaction((trx) => queryOverviewMetrics(trx, rangeToCutoff(range), range))
  )
}

// ---------------------------------------------------------------------------
// Chart data
// ---------------------------------------------------------------------------

export function fetchChartData(
  db: Knex,
  cache: CoalesceCache,
  range: string
): Promise<Record<string, unknown>[]> {
  return cache.cached('chartData:' + range, CHART_TTL, async () => {
    const rows = await db('server_stats_metrics')
      .where('bucket', '>=', rangeToCutoff(range))
      .orderBy('bucket', 'asc')
    return aggregateChartBuckets(rows, range)
  })
}

// ---------------------------------------------------------------------------
// Overview widgets
// ---------------------------------------------------------------------------

export interface OverviewWidgets {
  topEvents: { eventName: string; count: number }[]
  emailActivity: { sent: number; queued: number; failed: number }
  logLevelBreakdown: { error: number; warn: number; info: number; debug: number }
  statusDistribution: { '2xx': number; '3xx': number; '4xx': number; '5xx': number }
  slowestQueries: { sqlNormalized: string; avgDuration: number; count: number }[]
}

const EMPTY_WIDGETS: OverviewWidgets = {
  topEvents: [],
  emailActivity: { sent: 0, queued: 0, failed: 0 },
  logLevelBreakdown: { error: 0, warn: 0, info: 0, debug: 0 },
  statusDistribution: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  slowestQueries: [],
}

export function fetchOverviewWidgets(
  db: Knex,
  cache: CoalesceCache,
  range: string
): Promise<OverviewWidgets> {
  return cache.cached('overviewWidgets:' + range, WIDGETS_TTL, async () => {
    try {
      const raw = await queryWidgetData(db, rangeToCutoff(range))
      return {
        topEvents: mapTopEvents(raw.topEventsRaw),
        emailActivity: mapEmailActivity(raw.emailStatusRaw),
        logLevelBreakdown: mapLogLevelBreakdown(raw.logLevelsRaw),
        statusDistribution: mapStatusDistribution(raw.statusRaw),
        slowestQueries: mapSlowestQueries(raw.slowQueriesRaw),
      }
    } catch (err) {
      if (!overviewWidgetWarned) {
        overviewWidgetWarned = true
        log.warn('dashboard: getOverviewWidgets query failed — ' + (err as Error)?.message)
      }
      return EMPTY_WIDGETS
    }
  })
}

// ---------------------------------------------------------------------------
// Sparkline data
// ---------------------------------------------------------------------------

export function fetchSparklineData(
  db: Knex,
  cache: CoalesceCache,
  range: string
): Promise<Record<string, unknown>[]> {
  return cache.cached('sparkline:' + range, SPARKLINE_TTL, async () => {
    return (
      await db('server_stats_metrics')
        .where('bucket', '>=', rangeToCutoff(range))
        .orderBy('bucket', 'asc')
    ).slice(-15)
  })
}
