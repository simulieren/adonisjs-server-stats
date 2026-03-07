// ---------------------------------------------------------------------------
// Shared job/queue utility functions
//
// Extracted from React JobsTab and JobsSection (source of truth) to avoid
// duplication across React and Vue components. Follows the same pattern as
// log-utils.ts.
// ---------------------------------------------------------------------------

import type { JobRecord, JobStats } from './types.js'

/**
 * Available job status filter values (including the "show all" option).
 */
export const JOB_STATUS_FILTERS = [
  'all',
  'active',
  'waiting',
  'delayed',
  'completed',
  'failed',
] as const

/**
 * A single job status value (without the 'all' meta-filter).
 */
export type JobStatusFilter = (typeof JOB_STATUS_FILTERS)[number]

// ---------------------------------------------------------------------------
// CSS class mapping (debug panel)
// ---------------------------------------------------------------------------

/**
 * Return the CSS class for a given job status in the debug panel.
 *
 * @param status  The job status string (e.g. `'completed'`, `'failed'`).
 * @param prefix  CSS class prefix. Defaults to `'ss-dbg-job-status'`.
 * @returns       The full CSS class string, e.g. `'ss-dbg-job-status-completed'`.
 *                Falls back to `'ss-dbg-badge-muted'` for unknown statuses.
 */
export function getJobStatusCssClass(status: string, prefix = 'ss-dbg-job-status'): string {
  switch (status) {
    case 'completed':
    case 'failed':
    case 'active':
    case 'waiting':
    case 'delayed':
      return `${prefix}-${status}`
    default:
      return 'ss-dbg-badge-muted'
  }
}

// ---------------------------------------------------------------------------
// Dashboard badge color mapping
// ---------------------------------------------------------------------------

/**
 * Map a job status to a badge color name used in the dashboard UI.
 *
 * @param status  The job status string (e.g. `'active'`, `'failed'`).
 * @returns       A color name string (e.g. `'blue'`, `'red'`, `'muted'`).
 */
export function getJobStatusBadgeColor(status: string): string {
  switch (status) {
    case 'active':
      return 'blue'
    case 'waiting':
      return 'amber'
    case 'delayed':
      return 'purple'
    case 'completed':
      return 'green'
    case 'failed':
      return 'red'
    default:
      return 'muted'
  }
}

// ---------------------------------------------------------------------------
// Data extraction helpers
// ---------------------------------------------------------------------------

/**
 * Server response shape from the dashboard/debug API jobs endpoint.
 *
 * The server may return jobs under `jobs` or `data`, and stats under
 * `stats` or `overview`. We handle all variants to stay compatible
 * with different queue inspector implementations.
 */
interface JobsResponseLike {
  jobs?: JobRecord[] | Record<string, unknown>[]
  data?: JobRecord[] | Record<string, unknown>[]
  stats?: JobStats
  overview?: JobStats
  [key: string]: unknown
}

/**
 * Extract the jobs array from a server response.
 *
 * Handles the following shapes:
 * - `{ jobs: [...] }` — standard shape
 * - `{ data: [...] }` — alternative shape
 * - `[...]` — bare array
 * - `null` / `undefined` — returns empty array
 */
export function extractJobs(data: unknown): Record<string, unknown>[] {
  if (!data) return []
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  const d = data as JobsResponseLike
  return (d.jobs || d.data || []) as Record<string, unknown>[]
}

/**
 * Extract the job stats (overview) from a server response.
 *
 * Handles the following shapes:
 * - `{ stats: { active, waiting, ... } }`
 * - `{ overview: { active, waiting, ... } }`
 * - Returns `null` when no stats are available.
 */
export function extractJobStats(data: unknown): JobStats | null {
  if (!data || Array.isArray(data)) return null
  const d = data as JobsResponseLike
  return (d.stats || d.overview || null) as JobStats | null
}
