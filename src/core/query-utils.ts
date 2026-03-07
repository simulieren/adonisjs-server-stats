// ---------------------------------------------------------------------------
// Shared query analysis utilities
//
// Extracted from the React QueriesTab (source of truth) so that every
// frontend (React, Vue, Edge, etc.) uses identical business logic.
// ---------------------------------------------------------------------------

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
