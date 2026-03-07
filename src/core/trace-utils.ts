// ---------------------------------------------------------------------------
// Trace parsing utilities
//
// Shared helpers for parsing trace details from the API. The dashboard API
// may return spans/warnings as JSON strings (from SQLite) and field names
// in either snake_case or camelCase depending on the ORM layer. These
// utilities normalize the data into a consistent shape.
// ---------------------------------------------------------------------------

/**
 * Raw trace detail as returned by the dashboard API.
 *
 * Fields may arrive in either snake_case or camelCase depending on the
 * database driver / ORM serialization layer. Spans and warnings may be
 * JSON-encoded strings when coming from SQLite.
 */
export interface TraceDetail {
  method?: string
  url?: string
  status_code?: number
  statusCode?: number
  total_duration?: number
  totalDuration?: number
  duration?: number
  spanCount?: number
  span_count?: number
  spans: unknown[] | string
  warnings: string[] | string
}

/**
 * Normalized trace with consistent camelCase field names and parsed arrays.
 */
export interface NormalizedTrace {
  method: string
  url: string
  statusCode: number
  totalDuration: number
  spanCount: number
  spans: unknown[]
  warnings: string[]
}

/**
 * Parse raw span data that may be a JSON string, an array, or undefined.
 *
 * The dashboard API may return spans as a JSON-encoded string when the
 * underlying storage is SQLite. This function handles all cases and
 * always returns a plain array.
 */
export function parseTraceSpans(raw: unknown): unknown[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? raw : []
}

/**
 * Parse raw warning data that may be a JSON string, an array, or undefined.
 *
 * Same rationale as {@link parseTraceSpans} -- the warnings column may be
 * stored as a JSON string in SQLite.
 */
export function parseTraceWarnings(raw: unknown): string[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? (raw as string[]) : []
}

/**
 * Resolve a numeric field that may appear under a snake_case or camelCase key.
 *
 * Returns the first truthy value found, or the provided fallback (default `0`).
 */
export function resolveTraceField(
  trace: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
  fallback: number = 0
): number {
  return (trace[snakeKey] as number) || (trace[camelKey] as number) || fallback
}

/**
 * Normalize a raw trace record into a consistent shape with camelCase
 * field names and parsed span/warning arrays.
 *
 * Handles both snake_case and camelCase field names, and parses spans
 * and warnings from JSON strings if necessary.
 */
export function normalizeTraceFields(trace: Record<string, unknown>): NormalizedTrace {
  return {
    method: (trace.method as string) || '',
    url: (trace.url as string) || '',
    statusCode: resolveTraceField(trace, 'status_code', 'statusCode'),
    totalDuration:
      resolveTraceField(trace, 'total_duration', 'totalDuration') ||
      (trace.duration as number) ||
      0,
    spanCount: resolveTraceField(trace, 'span_count', 'spanCount'),
    spans: parseTraceSpans(trace.spans),
    warnings: parseTraceWarnings(trace.warnings),
  }
}
