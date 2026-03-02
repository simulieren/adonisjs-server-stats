/**
 * Shared JSON parsing utilities with safe fallbacks.
 */

/** Safely parse a JSON string, returning the original value on failure. */
export function safeParseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Safely parse a JSON string expected to be an array, returning [] on failure. */
export function safeParseJsonArray(value: unknown): unknown[] {
  const parsed = safeParseJson(value)
  return Array.isArray(parsed) ? parsed : []
}
