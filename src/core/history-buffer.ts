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
  const buffer: Record<string, number[]> = {}

  return {
    push(stats: ServerStats) {
      for (const metric of METRIC_DEFINITIONS) {
        const key = metric.historyKey
        if (!key) continue

        const value = metric.extract(stats)
        if (typeof value !== 'number') continue

        if (!buffer[key]) buffer[key] = []
        buffer[key].push(value)
        if (buffer[key].length > maxLength) buffer[key].shift()
      }
    },

    get(key: string): number[] {
      return buffer[key] || []
    },

    getAll() {
      return buffer
    },
  }
}
