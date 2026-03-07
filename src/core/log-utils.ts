// ---------------------------------------------------------------------------
// Shared log utility functions
//
// Extracted from React LogsTab (source of truth) to avoid duplication across
// React and Vue components.  Every resolver normalises the variety of field
// names that different logging back-ends may produce.
// ---------------------------------------------------------------------------

/**
 * Generic log entry – the resolver functions only rely on dynamic property
 * access, so a simple index-signature is sufficient.
 */
export interface LogEntry {
  [key: string]: unknown
}

/**
 * Available log level filter values (including the "show all" option).
 */
export const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

// ---------------------------------------------------------------------------
// Field resolvers
// ---------------------------------------------------------------------------

/** Resolve the log level string from whichever field the backend provides. */
export function resolveLogLevel(entry: LogEntry): string {
  return (
    (entry.levelName as string) ||
    (entry.level_name as string) ||
    (typeof entry.level === 'string' ? entry.level : '') ||
    'info'
  ).toLowerCase()
}

/** Resolve the message from whichever field the backend provides. */
export function resolveLogMessage(entry: LogEntry): string {
  return (entry.msg as string) || (entry.message as string) || JSON.stringify(entry)
}

/** Resolve the timestamp from whichever field the backend provides. */
export function resolveLogTimestamp(entry: LogEntry): number | string {
  return (
    (entry.createdAt as number | string) ||
    (entry.created_at as number | string) ||
    (entry.time as number) ||
    (entry.timestamp as number) ||
    0
  )
}

/** Resolve the request ID from whichever field the backend provides. */
export function resolveLogRequestId(entry: LogEntry): string {
  const logData = (entry.data || {}) as Record<string, unknown>
  return (
    (entry.requestId as string) ||
    (entry.request_id as string) ||
    (entry['x-request-id'] as string) ||
    (logData.requestId as string) ||
    (logData.request_id as string) ||
    (logData['x-request-id'] as string) ||
    ''
  )
}

// ---------------------------------------------------------------------------
// CSS class mapping
// ---------------------------------------------------------------------------

/**
 * Return the CSS class for a given log level.
 *
 * @param level  The resolved log level string (e.g. `'error'`, `'warn'`).
 * @param prefix CSS class prefix. Defaults to `'ss-dbg-log-level'`.
 */
export function getLogLevelCssClass(level: string, prefix = 'ss-dbg-log-level'): string {
  switch (level) {
    case 'error':
    case 'fatal':
      return `${prefix}-error`
    case 'warn':
      return `${prefix}-warn`
    case 'info':
      return `${prefix}-info`
    case 'debug':
      return `${prefix}-debug`
    case 'trace':
      return `${prefix}-trace`
    default:
      return `${prefix}-info`
  }
}

// ---------------------------------------------------------------------------
// Level filtering
// ---------------------------------------------------------------------------

/**
 * Filter an array of log entries by level.
 *
 * When `level` is `'all'` the original array is returned as-is.
 * The `'error'` filter also includes `'fatal'` entries (matching React behaviour).
 */
export function filterLogsByLevel(logs: LogEntry[], level: string): LogEntry[] {
  if (level === 'all') return logs
  return logs.filter((entry) => {
    const resolved = resolveLogLevel(entry)
    if (level === 'error') return resolved === 'error' || resolved === 'fatal'
    return resolved === level
  })
}
