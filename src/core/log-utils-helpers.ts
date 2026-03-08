// ---------------------------------------------------------------------------
// Helpers extracted from getStructuredData to reduce complexity and depth
// ---------------------------------------------------------------------------

import { STANDARD_LOG_KEYS } from './log-utils.js'

/**
 * Parse an entry's `data` field into a Record, if possible.
 *
 * Handles both raw objects and JSON-encoded strings. Returns `null`
 * if the field is not parseable as a plain object.
 */
export function parseDataBlob(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  return null
}

/**
 * Extract all keys from a record that are NOT in the standard log key set.
 *
 * Returns `null` when no non-standard keys are found.
 */
export function extractNonStandardKeys(
  record: Record<string, unknown>
): Record<string, unknown> | null {
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    if (!STANDARD_LOG_KEYS.has(k)) extra[k] = v
  }
  return Object.keys(extra).length > 0 ? extra : null
}
