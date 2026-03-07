// ---------------------------------------------------------------------------
// Framework-agnostic history buffer for metric sparklines
// ---------------------------------------------------------------------------
//
// Both React and Vue hooks maintain a rolling buffer of the last N numeric
// values per metric (for sparkline rendering). This module extracts that
// shared logic so both layers can delegate to it.
// ---------------------------------------------------------------------------

import { METRIC_DEFINITIONS, MAX_HISTORY } from './metrics.js'

import type { ServerStats } from './types.js'

/**
 * A rolling buffer that stores the last `maxLength` numeric values
 * for each metric defined in {@link METRIC_DEFINITIONS}.
 */
export interface HistoryBuffer {
  /** Push a new stats snapshot, extracting all numeric metric values. */
  push(stats: ServerStats): void
  /** Get the history array for a single key. Returns `[]` if not tracked. */
  get(key: string): number[]
  /** Get the entire history map (all keys). */
  getAll(): Record<string, number[]>
}

/**
 * Create a new history buffer that tracks numeric metric values
 * from {@link METRIC_DEFINITIONS}.
 *
 * @param maxLength - Maximum number of data points to retain per metric.
 *                    Defaults to {@link MAX_HISTORY} (60).
 * @returns A {@link HistoryBuffer} instance.
 */
export function createHistoryBuffer(maxLength: number = MAX_HISTORY): HistoryBuffer {
  // Use circular buffers to avoid O(N) Array.shift() on every push.
  // Each metric gets a fixed-size array with a write index.
  const rings: Record<string, { data: number[]; head: number; count: number }> = {}
  const cache: Record<string, number[]> = {}
  let cacheValid = false

  function toArray(ring: { data: number[]; head: number; count: number }): number[] {
    if (ring.count === 0) return []
    const result = new Array(ring.count)
    const start = ring.count < maxLength ? 0 : ring.head
    for (let i = 0; i < ring.count; i++) {
      result[i] = ring.data[(start + i) % maxLength]
    }
    return result
  }

  return {
    push(stats: ServerStats) {
      cacheValid = false
      for (const metric of METRIC_DEFINITIONS) {
        const key = metric.historyKey
        if (!key) continue

        const value = metric.extract(stats)
        if (typeof value !== 'number') continue

        if (!rings[key]) rings[key] = { data: new Array(maxLength), head: 0, count: 0 }
        const ring = rings[key]
        ring.data[ring.head] = value
        ring.head = (ring.head + 1) % maxLength
        if (ring.count < maxLength) ring.count++
      }
    },

    get(key: string): number[] {
      const ring = rings[key]
      return ring ? toArray(ring) : []
    },

    getAll() {
      if (cacheValid) return cache
      for (const key of Object.keys(rings)) {
        cache[key] = toArray(rings[key])
      }
      cacheValid = true
      return cache
    },
  }
}
