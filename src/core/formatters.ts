// ---------------------------------------------------------------------------
// Formatting functions
// ---------------------------------------------------------------------------
//
// Ported from src/edge/client/stats-bar.js and src/edge/client/dashboard.js.
// Pure functions with no DOM or framework dependencies.
// ---------------------------------------------------------------------------

import type { ThresholdColor } from './types.js'

// ---------------------------------------------------------------------------
// Uptime
// ---------------------------------------------------------------------------

/**
 * Format a duration in seconds as a human-readable uptime string.
 *
 * Examples: `"2d 5h"`, `"3h 12m"`, `"7m"`, `"0m"`.
 *
 * @param seconds - Uptime in seconds.
 */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/**
 * Format a byte count as a compact memory string.
 *
 * Examples: `"128M"`, `"1.2G"`.
 *
 * @param bytes - Value in bytes.
 */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`
  return `${mb.toFixed(0)}M`
}

/**
 * Format a megabyte value as a compact memory string.
 *
 * Examples: `"512.0M"`, `"1.2G"`.
 *
 * @param mb - Value in megabytes.
 */
export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`
  return `${mb.toFixed(1)}M`
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * Format a number with K/M suffixes.
 *
 * Examples: `"42"`, `"1.2K"`, `"3.4M"`.
 *
 * @param n - Numeric count.
 */
export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * Format a millisecond duration.
 *
 * Examples: `"12.34ms"`, `"0.50ms"`.
 *
 * @param ms - Duration in milliseconds.
 */
export function formatDuration(ms: number): string {
  return `${ms.toFixed(2)}ms`
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Format a Unix timestamp (ms) or ISO string as `HH:MM:SS.mmm`.
 *
 * Returns `'-'` if the input is falsy or produces an invalid date.
 *
 * @param ts - Unix timestamp in milliseconds, or an ISO date string.
 */
export function formatTime(ts: number | string): string {
  if (!ts) return '-'
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts)
  if (Number.isNaN(d.getTime())) return '-'
  return (
    d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  )
}

// ---------------------------------------------------------------------------
// Time ago
// ---------------------------------------------------------------------------

/**
 * Format a Unix timestamp (ms) or ISO string as a relative time string.
 *
 * Examples: `"3s ago"`, `"2m ago"`, `"5h ago"`, `"1d ago"`, `"just now"`.
 *
 * Returns `'-'` if the input is falsy.
 *
 * @param ts - Unix timestamp in milliseconds, or an ISO date string.
 */
export function timeAgo(ts: number | string): string {
  if (!ts) return '-'
  const d = typeof ts === 'string' ? new Date(ts).getTime() : ts
  const diff = Math.floor((Date.now() - d) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ---------------------------------------------------------------------------
// Stat formatting (generic, unit-aware)
// ---------------------------------------------------------------------------

/**
 * Format a numeric value with the appropriate unit suffix.
 *
 * Used in tooltips to display min/max/avg with consistent formatting.
 *
 * @param value - The numeric value.
 * @param unit  - Unit string (`'%'`, `'ms'`, `'MB'`, `'bytes'`, `'/s'`, `'/m'`).
 */
export function formatStatNum(value: number, unit: string): string {
  switch (unit) {
    case '%':
      return `${value.toFixed(1)}%`
    case 'ms':
      return `${value.toFixed(0)}ms`
    case 'MB':
      return `${value.toFixed(1)}M`
    case 'bytes':
      return formatBytes(value)
    case '/s':
    case '/m':
      return value.toFixed(1)
    default:
      return value.toFixed(1)
  }
}

// ---------------------------------------------------------------------------
// Threshold colors
// ---------------------------------------------------------------------------

/**
 * Determine threshold color for a metric where higher values are worse.
 *
 * - `value > critThreshold` -> `'red'`
 * - `value > warnThreshold` -> `'amber'`
 * - Otherwise -> `'green'`
 *
 * @param value         - Current metric value.
 * @param warnThreshold - Threshold above which the value is "warning".
 * @param critThreshold - Threshold above which the value is "critical".
 */
export function getThresholdColor(
  value: number,
  warnThreshold: number,
  critThreshold: number
): ThresholdColor {
  if (value > critThreshold) return 'red'
  if (value > warnThreshold) return 'amber'
  return 'green'
}

/**
 * Determine threshold color for a metric where lower values are worse
 * (e.g. cache hit rate, free memory).
 *
 * - `value < critThreshold` -> `'red'`
 * - `value < warnThreshold` -> `'amber'`
 * - Otherwise -> `'green'`
 *
 * @param value         - Current metric value.
 * @param warnThreshold - Threshold below which the value is "warning".
 * @param critThreshold - Threshold below which the value is "critical".
 */
export function getThresholdColorInverse(
  value: number,
  warnThreshold: number,
  critThreshold: number
): ThresholdColor {
  if (value < critThreshold) return 'red'
  if (value < warnThreshold) return 'amber'
  return 'green'
}

// ---------------------------------------------------------------------------
// Ratio color (used for pool utilization)
// ---------------------------------------------------------------------------

/**
 * Determine threshold color based on a used/max ratio.
 *
 * - `> 80%` utilized -> `'red'`
 * - `> 50%` utilized -> `'amber'`
 * - Otherwise -> `'green'`
 * - If `max` is 0, returns `'green'` (no pool configured).
 *
 * @param used - Number of items in use.
 * @param max  - Maximum capacity.
 */
export function getRatioColor(used: number, max: number): ThresholdColor {
  if (max === 0) return 'green'
  const ratio = used / max
  if (ratio > 0.8) return 'red'
  if (ratio > 0.5) return 'amber'
  return 'green'
}

// ---------------------------------------------------------------------------
// CSS class mapping
// ---------------------------------------------------------------------------

/**
 * Map from threshold color to the CSS class used in the Edge-based UI.
 * Components can use this to apply the same visual styling.
 */
export const THRESHOLD_CSS_CLASS: Record<ThresholdColor, string> = {
  green: 'ss-green',
  amber: 'ss-amber',
  red: 'ss-red',
}

/**
 * Fallback hex colors for each threshold level.
 * Used when CSS custom properties are not available.
 */
export const THRESHOLD_HEX_FALLBACK: Record<ThresholdColor, string> = {
  green: '#34d399',
  amber: '#fbbf24',
  red: '#f87171',
}

/**
 * CSS custom property names for each threshold color.
 * Components should read these from `getComputedStyle()` when available.
 */
export const THRESHOLD_CSS_VAR: Record<ThresholdColor, string> = {
  green: '--ss-accent',
  amber: '--ss-amber-fg',
  red: '--ss-red-fg',
}

// ---------------------------------------------------------------------------
// Status color (HTTP status code -> threshold color)
// ---------------------------------------------------------------------------

/**
 * Map an HTTP status code to a threshold color.
 *
 * - 2xx -> `'green'`
 * - 3xx -> `'green'`
 * - 4xx -> `'amber'`
 * - 5xx -> `'red'`
 * - Other -> `'green'`
 *
 * @param statusCode - HTTP status code.
 */
export function statusColor(statusCode: number): ThresholdColor {
  if (statusCode >= 500) return 'red'
  if (statusCode >= 400) return 'amber'
  return 'green'
}

// ---------------------------------------------------------------------------
// Duration severity
// ---------------------------------------------------------------------------

/**
 * Classify a duration (ms) as normal, slow, or very-slow.
 *
 * - `> 500ms` -> `'very-slow'`
 * - `> 100ms` -> `'slow'`
 * - Otherwise -> `'normal'`
 *
 * @param ms - Duration in milliseconds.
 */
export function durationSeverity(ms: number): 'normal' | 'slow' | 'very-slow' {
  if (ms > 500) return 'very-slow'
  if (ms > 100) return 'slow'
  return 'normal'
}

// ---------------------------------------------------------------------------
// Short request ID
// ---------------------------------------------------------------------------

/**
 * Truncate a request ID to a short preview.
 *
 * Shows the first 8 characters followed by an ellipsis.
 *
 * @param reqId - Full request ID string.
 */
export function shortReqId(reqId: string): string {
  if (!reqId) return '--'
  if (reqId.length <= 8) return reqId
  return reqId.slice(0, 8) + '\u2026'
}

// ---------------------------------------------------------------------------
// Compact JSON preview
// ---------------------------------------------------------------------------

/**
 * Create a compact string preview of a JSON value.
 *
 * Recursively abbreviates objects and arrays so the output is
 * human-readable at a glance. Strings are quoted and truncated,
 * arrays show the first 3 items, objects show the first 4 keys.
 * Falls back to a keys-only summary if the detailed preview
 * exceeds `maxLen`.
 *
 * Ported from `src/edge/client/dashboard.js` `compactPreview()`.
 *
 * @param value  - Any JSON-serializable value.
 * @param maxLen - Maximum preview length (default 100).
 */
export function compactPreview(value: unknown, maxLen: number = 100): string {
  if (value === null) return 'null'
  if (value === undefined) return '-'
  if (typeof value === 'string') {
    return '"' + (value.length > 40 ? value.slice(0, 40) + '...' : value) + '"'
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.slice(0, 3).map((v) => compactPreview(v, 30))
    const s = '[' + items.join(', ') + (value.length > 3 ? ', ...' + value.length + ' items' : '') + ']'
    return s.length > maxLen ? '[' + value.length + ' items]' : s
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length === 0) return '{}'
    const pairs: string[] = []
    for (let i = 0; i < Math.min(keys.length, 4); i++) {
      pairs.push(keys[i] + ': ' + compactPreview((value as Record<string, unknown>)[keys[i]], 30))
    }
    const s = '{ ' + pairs.join(', ') + (keys.length > 4 ? ', ...+' + (keys.length - 4) : '') + ' }'
    return s.length > maxLen
      ? '{ ' + keys.slice(0, 6).join(', ') + (keys.length > 6 ? ', ...' : '') + ' }'
      : s
  }
  return String(value)
}
