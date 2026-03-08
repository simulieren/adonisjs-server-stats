import { test } from '@japa/runner'
import {
  buildOverviewResult,
  mapTopEvents,
  mapEmailActivity,
  mapLogLevelBreakdown,
  mapStatusDistribution,
  mapSlowestQueries,
  aggregateChartBuckets,
} from '../src/dashboard/overview_queries.js'

// ---------------------------------------------------------------------------
// buildOverviewResult
// ---------------------------------------------------------------------------

test.group('buildOverviewResult', () => {
  test('returns zero metrics when total is 0', ({ assert }) => {
    const result = buildOverviewResult({ total: 0, stats: null, range: '1h', slowestEndpoints: [], queryStats: null, recentErrors: [] })
    assert.equal(result.avgResponseTime, 0)
    assert.equal(result.p95ResponseTime, 0)
    assert.equal(result.requestsPerMinute, 0)
    assert.equal(result.errorRate, 0)
    assert.equal(result.totalRequests, 0)
    assert.deepEqual(result.slowestEndpoints, [])
    assert.deepEqual(result.queryStats, { total: 0, avgDuration: 0, perRequest: 0 })
    assert.deepEqual(result.recentErrors, [])
  })

  test('computes metrics for non-zero total', ({ assert }) => {
    const stats = {
      avg_duration: 50.5678,
      error_count: 10,
    }
    const slowest = [
      { url: '/api/users', count: 5, avg_duration: 120.5 },
    ]
    const queryStats = { total: 100, avg_duration: 3.45 }
    const recentErrors = [
      { id: 1, message: 'Error occurred', created_at: '2024-01-01' },
    ]

    const result = buildOverviewResult({ total: 200, stats, range: '1h', slowestEndpoints: slowest, queryStats, recentErrors })

    assert.equal(result.avgResponseTime, 50.57)
    assert.equal(result.totalRequests, 200)
    assert.equal(result.errorRate, 5) // (10/200)*100 = 5
    assert.lengthOf(result.slowestEndpoints, 1)
    assert.equal(result.slowestEndpoints[0].url, '/api/users')
    assert.equal(result.queryStats.total, 100)
    assert.equal(result.queryStats.perRequest, 0.5) // 100/200
    assert.lengthOf(result.recentErrors, 1)
  })
})

// ---------------------------------------------------------------------------
// mapTopEvents
// ---------------------------------------------------------------------------

test.group('mapTopEvents', () => {
  test('maps raw event rows', ({ assert }) => {
    const raw = [
      { event_name: 'user:registered', count: 42 },
      { event_name: 'order:placed', count: 15 },
    ]
    const result = mapTopEvents(raw)
    assert.lengthOf(result, 2)
    assert.equal(result[0].eventName, 'user:registered')
    assert.equal(result[0].count, 42)
  })

  test('returns empty array for null/undefined input', ({ assert }) => {
    assert.deepEqual(mapTopEvents(null), [])
    assert.deepEqual(mapTopEvents(undefined), [])
  })
})

// ---------------------------------------------------------------------------
// mapEmailActivity
// ---------------------------------------------------------------------------

test.group('mapEmailActivity', () => {
  test('aggregates email status counts', ({ assert }) => {
    const raw = [
      { status: 'sent', count: 10 },
      { status: 'sending', count: 5 },
      { status: 'queued', count: 3 },
      { status: 'queueing', count: 2 },
      { status: 'failed', count: 1 },
    ]
    const result = mapEmailActivity(raw)
    assert.equal(result.sent, 15) // sent + sending
    assert.equal(result.queued, 5) // queued + queueing
    assert.equal(result.failed, 1)
  })

  test('returns zeros for empty input', ({ assert }) => {
    const result = mapEmailActivity([])
    assert.equal(result.sent, 0)
    assert.equal(result.queued, 0)
    assert.equal(result.failed, 0)
  })

  test('handles null input', ({ assert }) => {
    const result = mapEmailActivity(null)
    assert.equal(result.sent, 0)
    assert.equal(result.queued, 0)
    assert.equal(result.failed, 0)
  })
})

// ---------------------------------------------------------------------------
// mapLogLevelBreakdown
// ---------------------------------------------------------------------------

test.group('mapLogLevelBreakdown', () => {
  test('maps log levels', ({ assert }) => {
    const raw = [
      { level: 'error', count: 5 },
      { level: 'warn', count: 10 },
      { level: 'info', count: 100 },
      { level: 'debug', count: 50 },
    ]
    const result = mapLogLevelBreakdown(raw)
    assert.equal(result.error, 5)
    assert.equal(result.warn, 10)
    assert.equal(result.info, 100)
    assert.equal(result.debug, 50)
  })

  test('ignores unknown levels', ({ assert }) => {
    const raw = [
      { level: 'error', count: 3 },
      { level: 'trace', count: 99 }, // not in breakdown
    ]
    const result = mapLogLevelBreakdown(raw)
    assert.equal(result.error, 3)
    assert.equal(result.warn, 0)
    assert.equal(result.info, 0)
    assert.equal(result.debug, 0)
  })

  test('handles null input', ({ assert }) => {
    const result = mapLogLevelBreakdown(null)
    assert.equal(result.error, 0)
    assert.equal(result.warn, 0)
  })
})

// ---------------------------------------------------------------------------
// mapStatusDistribution
// ---------------------------------------------------------------------------

test.group('mapStatusDistribution', () => {
  test('maps status code ranges', ({ assert }) => {
    const raw = { s2xx: 100, s3xx: 20, s4xx: 10, s5xx: 5 }
    const result = mapStatusDistribution(raw)
    assert.equal(result['2xx'], 100)
    assert.equal(result['3xx'], 20)
    assert.equal(result['4xx'], 10)
    assert.equal(result['5xx'], 5)
  })

  test('handles null row', ({ assert }) => {
    const result = mapStatusDistribution(null)
    assert.equal(result['2xx'], 0)
    assert.equal(result['3xx'], 0)
    assert.equal(result['4xx'], 0)
    assert.equal(result['5xx'], 0)
  })
})

// ---------------------------------------------------------------------------
// mapSlowestQueries
// ---------------------------------------------------------------------------

test.group('mapSlowestQueries', () => {
  test('maps slow query rows', ({ assert }) => {
    const raw = [
      { sql_normalized: 'SELECT * FROM ?', avg_duration: 45.67, count: 12 },
    ]
    const result = mapSlowestQueries(raw)
    assert.lengthOf(result, 1)
    assert.equal(result[0].sqlNormalized, 'SELECT * FROM ?')
    assert.equal(result[0].avgDuration, 45.67)
    assert.equal(result[0].count, 12)
  })

  test('returns empty array for null', ({ assert }) => {
    assert.deepEqual(mapSlowestQueries(null), [])
  })
})

// ---------------------------------------------------------------------------
// aggregateChartBuckets
// ---------------------------------------------------------------------------

test.group('aggregateChartBuckets', () => {
  test('passes through rows for 1h range', ({ assert }) => {
    const rows = [
      { bucket: '2024-01-01 10:00', request_count: 5, avg_duration: 100, p95_duration: 200, error_count: 1, query_count: 10, avg_query_duration: 5 },
    ]
    const result = aggregateChartBuckets(rows, '1h')
    assert.deepEqual(result, rows)
  })

  test('passes through rows for 6h range', ({ assert }) => {
    const rows = [{ bucket: '2024-01-01 10:00', request_count: 1, avg_duration: 50, p95_duration: 100, error_count: 0, query_count: 2, avg_query_duration: 3 }]
    const result = aggregateChartBuckets(rows, '6h')
    assert.deepEqual(result, rows)
  })

  test('groups rows into 15-min buckets for 24h range', ({ assert }) => {
    // Two rows in the same 15-min bucket
    const rows = [
      { bucket: '2024-01-01 10:01', request_count: 5, avg_duration: 100, p95_duration: 200, error_count: 1, query_count: 10, avg_query_duration: 5 },
      { bucket: '2024-01-01 10:14', request_count: 3, avg_duration: 80, p95_duration: 150, error_count: 0, query_count: 6, avg_query_duration: 4 },
    ]
    const result = aggregateChartBuckets(rows, '24h')
    assert.lengthOf(result, 1)
    assert.equal(result[0].request_count, 8) // 5 + 3
    assert.equal(result[0].error_count, 1) // 1 + 0
    assert.equal(result[0].query_count, 16) // 10 + 6
    assert.equal(result[0].p95_duration, 200) // max(200, 150)
  })

  test('groups rows into 60-min buckets for 7d range', ({ assert }) => {
    const rows = [
      { bucket: '2024-01-01 10:00', request_count: 5, avg_duration: 100, p95_duration: 200, error_count: 1, query_count: 10, avg_query_duration: 5 },
      { bucket: '2024-01-01 10:30', request_count: 3, avg_duration: 80, p95_duration: 150, error_count: 0, query_count: 6, avg_query_duration: 4 },
      { bucket: '2024-01-01 11:00', request_count: 2, avg_duration: 60, p95_duration: 100, error_count: 2, query_count: 4, avg_query_duration: 3 },
    ]
    const result = aggregateChartBuckets(rows, '7d')
    assert.lengthOf(result, 2) // 10:xx grouped, 11:xx separate
  })

  test('returns empty array for empty input', ({ assert }) => {
    assert.deepEqual(aggregateChartBuckets([], '24h'), [])
  })
})
