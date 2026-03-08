import { safeParseJson, safeParseJsonArray } from '../utils/json_helpers.js'

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; lastPage: number }
}

export interface ChartBucket {
  bucket: string
  requestCount: number
  avgDuration: number
  p95Duration: number
  errorCount: number
  queryCount: number
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number
): PaginatedResponse<T> {
  return {
    data,
    meta: { total, page, perPage, lastPage: Math.max(1, Math.ceil(total / perPage)) },
  }
}

export function emptyPage<T>(page: number, perPage: number): PaginatedResponse<T> {
  return { data: [], meta: { total: 0, page, perPage, lastPage: 1 } }
}

export function formatRequest(r: Record<string, unknown>) {
  return {
    id: r.id,
    method: r.method,
    url: r.url,
    statusCode: r.status_code,
    duration: r.duration,
    spanCount: r.span_count,
    warningCount: r.warning_count,
    createdAt: r.created_at,
    ...(r.http_request_id ? { httpRequestId: r.http_request_id } : {}),
  }
}

export function formatQuery(q: Record<string, unknown>) {
  return {
    id: q.id,
    requestId: q.request_id,
    sql: q.sql_text,
    sqlNormalized: q.sql_normalized,
    bindings: safeParseJson(q.bindings),
    duration: q.duration,
    method: q.method,
    model: q.model,
    connection: q.connection,
    inTransaction: !!q.in_transaction,
    createdAt: q.created_at,
  }
}

export function formatTrace(t: Record<string, unknown>) {
  return {
    id: t.id,
    requestId: t.request_id,
    method: t.method,
    url: t.url,
    statusCode: t.status_code,
    totalDuration: t.total_duration,
    spanCount: t.span_count,
    spans: safeParseJson(t.spans) ?? [],
    warnings: safeParseJsonArray(t.warnings),
    createdAt: t.created_at,
    ...(t.http_request_id ? { httpRequestId: t.http_request_id } : {}),
  }
}

export function formatLog(l: Record<string, unknown>) {
  return {
    id: l.id,
    level: l.level,
    message: l.message,
    requestId: l.request_id,
    data: l.data,
    createdAt: l.created_at,
  }
}

export function mapChartBucket(b: Record<string, unknown>): ChartBucket {
  return {
    bucket: b.bucket as string,
    requestCount: b.request_count as number,
    avgDuration: b.avg_duration as number,
    p95Duration: b.p95_duration as number,
    errorCount: b.error_count as number,
    queryCount: b.query_count as number,
  }
}

export function emptyOverview() {
  return {
    avgResponseTime: 0,
    p95ResponseTime: 0,
    requestsPerMinute: 0,
    errorRate: 0,
    sparklines: {
      avgResponseTime: [],
      p95ResponseTime: [],
      requestsPerMinute: [],
      errorRate: [],
    },
    slowestEndpoints: [],
    queryStats: { total: 0, avgDuration: 0, perRequest: 0 },
    recentErrors: [],
    topEvents: [],
    emailActivity: { sent: 0, queued: 0, failed: 0 },
    logLevelBreakdown: { error: 0, warn: 0, info: 0, debug: 0 },
    statusDistribution: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    slowestQueries: [],
    cacheStats: null,
    jobQueueStatus: null,
  }
}

import { round } from '../utils/math_helpers.js'

/** Build sparklines from raw sparkline data. */
export function buildSparklines(data: Record<string, unknown>[]) {
  return {
    avgResponseTime: data.map((m) => m.avg_duration),
    p95ResponseTime: data.map((m) => m.p95_duration),
    requestsPerMinute: data.map((m) => m.request_count),
    errorRate: data.map((m) =>
      (m.request_count as number) > 0
        ? round(((m.error_count as number) / (m.request_count as number)) * 100)
        : 0
    ),
  }
}

/** Format grouped query results. */
export function formatGroupedQuery(g: Record<string, unknown>, totalTime: number) {
  return {
    sqlNormalized: g.sql_normalized,
    count: g.count,
    avgDuration: round(g.avg_duration as number),
    minDuration: round(g.min_duration as number),
    maxDuration: round(g.max_duration as number),
    totalDuration: round(g.total_duration as number),
    percentOfTotal: totalTime > 0 ? round(((g.total_duration as number) / totalTime) * 100) : 0,
  }
}

/** Run EXPLAIN on a query, returning the plan. */
export async function runExplain(
  appDb: { raw: (sql: string, bindings: unknown[]) => Promise<Record<string, unknown>> },
  query: Record<string, unknown>
) {
  let bindings: unknown[] = []
  if (query.bindings) {
    try {
      bindings = JSON.parse(query.bindings as string)
    } catch {
      /* skip */
    }
  }
  const explainResult = await appDb.raw(`EXPLAIN (FORMAT JSON) ${query.sql_text}`, bindings)
  const rawRows =
    (explainResult?.rows as Record<string, unknown>[]) ??
    (Array.isArray(explainResult) ? explainResult : [])
  if (rawRows.length > 0 && rawRows[0]['QUERY PLAN']) {
    return rawRows[0]['QUERY PLAN'] as unknown[]
  }
  return rawRows
}
