// ---------------------------------------------------------------------------
// Shared query analysis utilities
//
// Extracted from the React QueriesTab (source of truth) so that every
// frontend (React, Vue, Edge, etc.) uses identical business logic.
// ---------------------------------------------------------------------------

import { SLOW_DURATION_MS } from './constants.js'
import { resolveField, resolveNormalizedSql, resolveSqlMethod, resolveTimestamp } from './field-resolvers.js'

import type { QueryRecord } from './types.js'

/**
 * Summary statistics computed over a set of queries.
 */
export interface QuerySummary {
  /** Number of queries whose duration exceeds 100 ms. */
  slowCount: number
  /** Number of unique SQL strings that appear more than once. */
  dupCount: number
  /** Mean duration across all queries (0 when there are none). */
  avgDuration: number
  /** Total number of queries considered. */
  totalCount: number
}

/**
 * A normalized query record with consistent camelCase field names.
 *
 * Used to convert untyped API responses (which may use snake_case) into
 * a clean typed object.
 */
export interface NormalizedQuery {
  id: number | string
  sql: string
  sqlNormalized: string
  duration: number
  method: string
  model: string
  connection: string
  timestamp: string | number
  inTransaction: boolean
}

/**
 * Filter queries by a search term.
 *
 * Matches case-insensitively against the `sql`, `model`, and `method`
 * fields.  Returns the full array when the search string is empty.
 */
export function filterQueries(queries: QueryRecord[], search: string): QueryRecord[] {
  if (!search) return queries
  const lower = search.toLowerCase()
  return queries.filter(
    (q) =>
      q.sql.toLowerCase().includes(lower) ||
      (q.model && q.model.toLowerCase().includes(lower)) ||
      q.method.toLowerCase().includes(lower)
  )
}

/**
 * Count how many times each SQL string appears in the list.
 *
 * The returned record maps each SQL string to its occurrence count.
 */
export function countDuplicateQueries(queries: QueryRecord[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const q of queries) {
    counts[q.sql] = (counts[q.sql] || 0) + 1
  }
  return counts
}

/**
 * Compute high-level summary statistics for a set of queries.
 *
 * @param queries   – the full (unfiltered) query list
 * @param dupCounts – the duplicate-count map returned by {@link countDuplicateQueries}
 */
export function computeQuerySummary(
  queries: QueryRecord[],
  dupCounts: Record<string, number>
): QuerySummary {
  const slowCount = queries.filter((q) => q.duration > 100).length
  const dupCount = Object.values(dupCounts).filter((c) => c > 1).length
  const avgDuration =
    queries.length > 0 ? queries.reduce((sum, q) => sum + q.duration, 0) / queries.length : 0
  return { slowCount, dupCount, avgDuration, totalCount: queries.length }
}

// ---------------------------------------------------------------------------
// Dashboard (untyped) variants
// ---------------------------------------------------------------------------

/**
 * Compute summary statistics from untyped dashboard API query records.
 *
 * Uses field-resolvers to extract duration values from `Record<string, unknown>`
 * rows, making it work with both snake_case and camelCase API responses.
 *
 * @param queries - Untyped query rows from the dashboard API.
 * @param meta    - Optional pagination meta with the total count.
 */
export function computeDashboardQuerySummary(
  queries: Record<string, unknown>[],
  meta?: { total?: number }
): QuerySummary {
  let slowCount = 0
  let totalDur = 0

  for (const q of queries) {
    const dur = (resolveField<number>(q, 'duration') ?? 0)
    totalDur += dur
    if (dur > SLOW_DURATION_MS) slowCount++
  }

  const sqlCounts = buildSqlCounts(queries)
  let dupCount = 0
  for (const c of sqlCounts.values()) {
    if (c > 1) dupCount += c
  }

  const avgDuration = queries.length > 0 ? totalDur / queries.length : 0
  const totalCount = meta?.total ?? queries.length

  return { slowCount, dupCount, avgDuration, totalCount }
}

/**
 * Normalize an untyped dashboard API query row to a clean typed object.
 *
 * Handles both snake_case and camelCase field names using field-resolvers.
 *
 * @param row - An untyped row from the dashboard queries API.
 */
export function normalizeDashboardQuery(row: Record<string, unknown>): NormalizedQuery {
  return {
    id: resolveField<number | string>(row, 'id') ?? 0,
    sql: resolveField<string>(row, 'sql', 'sql_text') ?? '',
    sqlNormalized: resolveNormalizedSql(row),
    duration: resolveField<number>(row, 'duration') ?? 0,
    method: resolveSqlMethod(row),
    model: resolveField<string>(row, 'model') ?? '',
    connection: resolveField<string>(row, 'connection') ?? '',
    timestamp: resolveTimestamp(row) ?? 0,
    inTransaction: resolveField<boolean>(row, 'inTransaction', 'in_transaction') ?? false,
  }
}

/**
 * Build a map counting how many times each SQL pattern appears.
 *
 * Works with both typed `QueryRecord[]` and untyped dashboard rows.
 * Uses `sqlNormalized` (or `sql` as fallback) as the grouping key.
 *
 * @param queries - Array of query objects with at least `sqlNormalized` or `sql`.
 */
export function buildSqlCounts(
  queries: Array<{ sqlNormalized?: string; sql?: string } | Record<string, unknown>>
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const q of queries) {
    const row = q as Record<string, unknown>
    const sql = resolveNormalizedSql(row)
    counts.set(sql, (counts.get(sql) || 0) + 1)
  }
  return counts
}
