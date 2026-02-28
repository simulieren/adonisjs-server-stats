// ---------------------------------------------------------------------------
// Shared helpers for the Internals / Diagnostics UI
// ---------------------------------------------------------------------------
//
// Pure functions used by both React (InternalsContent, InternalsSection)
// and Vue (InternalsTab, InternalsSection) to render diagnostics data.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

const SECRET_KEYS = ['password', 'secret', 'token', 'key', 'credential', 'auth']

/**
 * Check whether a configuration key name likely contains a secret value.
 *
 * Matches common patterns like `password`, `secret`, `token`, `key`,
 * `credential`, and `auth` (case-insensitive substring match).
 */
export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SECRET_KEYS.some((s) => lower.includes(s))
}

// ---------------------------------------------------------------------------
// Config value formatting
// ---------------------------------------------------------------------------

/**
 * Format a configuration value for display.
 *
 * - `null`/`undefined` -> `'-'`
 * - Primitives -> `String(value)`
 * - Arrays -> comma-joined or `'-'` if empty
 * - Objects -> JSON stringified
 */
export function formatConfigVal(val: unknown): string {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
    return String(val)
  if (Array.isArray(val)) return val.join(', ') || '-'
  try {
    return JSON.stringify(val)
  } catch {
    return String(val)
  }
}

// ---------------------------------------------------------------------------
// Timer labels
// ---------------------------------------------------------------------------

/**
 * Human-readable display names for internal timer keys.
 */
export const TIMER_LABELS: Record<string, string> = {
  collectionInterval: 'Stats Collection',
  dashboardBroadcast: 'Dashboard Broadcast',
  debugBroadcast: 'Debug Broadcast',
  persistFlush: 'Persist Flush',
  retentionCleanup: 'Retention Cleanup',
}

/**
 * Get a human-readable label for a timer key.
 * Falls back to the raw key name if no label is defined.
 */
export function getTimerLabel(name: string): string {
  return TIMER_LABELS[name] || name
}

// ---------------------------------------------------------------------------
// Integration labels
// ---------------------------------------------------------------------------

/**
 * Human-readable display names for integration keys.
 */
export const INTEGRATION_LABELS: Record<string, string> = {
  prometheus: 'Prometheus',
  pinoHook: 'Pino Log Hook',
  edgePlugin: 'Edge Plugin',
  cacheInspector: 'Cache Inspector',
  queueInspector: 'Queue Inspector',
}

/**
 * Get a human-readable label for an integration key.
 * Falls back to the raw key name if no label is defined.
 */
export function getIntegrationLabel(name: string): string {
  return INTEGRATION_LABELS[name] || name
}

// ---------------------------------------------------------------------------
// Integration status / details
// ---------------------------------------------------------------------------

/**
 * Determine the display status string for an integration entry.
 */
export function getIntegrationStatus(info: {
  active?: boolean
  available?: boolean
}): string {
  if ('active' in info) return info.active ? 'active' : 'inactive'
  if ('available' in info) return info.available ? 'available' : 'unavailable'
  return 'unknown'
}

/**
 * Determine the detail description for an integration entry.
 */
export function getIntegrationDetails(
  key: string,
  info: { active?: boolean; available?: boolean; mode?: string }
): string {
  if (info.mode) return `Mode: ${info.mode}`
  if (key === 'edgePlugin' && info.active) return '@serverStats() tag registered'
  if (key === 'cacheInspector')
    return info.available ? 'Redis dependency detected' : 'Redis not installed'
  if (key === 'queueInspector')
    return info.available
      ? 'Queue dependency detected'
      : '@rlanz/bull-queue not installed'
  return '-'
}

// ---------------------------------------------------------------------------
// Collector config formatting
// ---------------------------------------------------------------------------

/**
 * Format a collector's config object into a display-friendly array.
 */
export function formatCollectorConfig(
  config: Record<string, unknown>
): Array<{ key: string; value: string; secret: boolean }> {
  return Object.entries(config).map(([k, v]) => ({
    key: k,
    value: formatConfigVal(v),
    secret: isSecretKey(k),
  }))
}

// ---------------------------------------------------------------------------
// Buffer fill percentage
// ---------------------------------------------------------------------------

/**
 * Compute the fill percentage of a buffer (0-100, clamped).
 */
export function fillPercent(current: number, max: number): number {
  if (!max) return 0
  return Math.min(100, Math.round((current / max) * 100))
}

// ---------------------------------------------------------------------------
// Status dot classification
// ---------------------------------------------------------------------------

/** Status strings that map to an "ok" visual indicator. */
export const OK_STATUSES = ['healthy', 'active', 'connected', 'available', 'ready']

/** Status strings that map to an "error" visual indicator. */
export const ERROR_STATUSES = ['errored', 'unavailable']

/**
 * Classify a status string as 'ok', 'err', or neutral.
 * Useful for mapping to CSS classes like `prefix-dot-ok` / `prefix-dot-err`.
 */
export function classifyStatus(status: string): 'ok' | 'err' | '' {
  if (OK_STATUSES.includes(status)) return 'ok'
  if (ERROR_STATUSES.includes(status)) return 'err'
  return ''
}
