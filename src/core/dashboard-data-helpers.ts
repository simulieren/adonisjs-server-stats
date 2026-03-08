// ---------------------------------------------------------------------------
// Helpers extracted from DashboardDataController.fetch() to reduce complexity
// ---------------------------------------------------------------------------

import type { PaginatedResponse } from './types.js'

/**
 * Check if a result is a paginated response (has data + meta).
 */
export function isPaginatedResult(
  result: unknown
): result is { data: unknown; meta: PaginatedResponse<unknown>['meta'] } {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  return r.data !== undefined && r.meta !== undefined
}

/**
 * Check if an error is an AbortError (request was cancelled).
 */
export function isAbortedRequest(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return err instanceof DOMException && err.name === 'AbortError'
}
