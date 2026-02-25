/**
 * Shared time/range utilities for dashboard store, controller, and chart aggregator.
 */

const RANGE_MAP: Record<string, number> = {
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10080,
}

/** Convert a range string (e.g. '1h', '7d') to total minutes. */
export function rangeToMinutes(range: string): number {
  return RANGE_MAP[range] ?? 60
}

/** Convert a range string to a SQLite-compatible datetime cutoff. */
export function rangeToCutoff(range: string): string {
  const minutes = rangeToMinutes(range)
  return toSqliteTimestamp(new Date(Date.now() - minutes * 60_000))
}

/** Convert a Date to a SQLite-compatible datetime string (YYYY-MM-DD HH:MM:SS). */
export function toSqliteTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

/** Round a bucket timestamp string down to the nearest N minutes. */
export function roundBucket(bucket: string, minutes: number): string {
  const date = new Date(bucket.replace(' ', 'T') + 'Z')
  const ms = minutes * 60_000
  const rounded = new Date(Math.floor(date.getTime() / ms) * ms)
  return toSqliteTimestamp(rounded)
}
