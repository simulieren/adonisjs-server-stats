// ---------------------------------------------------------------------------
// Helpers extracted from compactPreview to reduce complexity
// ---------------------------------------------------------------------------

/**
 * Create a compact preview of a string value.
 * Truncates at 40 characters and wraps in quotes.
 */
export function previewString(value: string): string {
  return '"' + (value.length > 40 ? value.slice(0, 40) + '...' : value) + '"'
}

/**
 * Create a compact preview of an array value.
 * Shows first 3 items with a summary for larger arrays.
 *
 * @param value  - The array to preview.
 * @param maxLen - Maximum preview string length before falling back to a summary.
 * @param recurse - Function to recursively preview nested values.
 */
export function previewArray(
  value: unknown[],
  maxLen: number,
  recurse: (v: unknown, max: number) => string
): string {
  if (value.length === 0) return '[]'
  const items = value.slice(0, 3).map((v) => recurse(v, 30))
  const suffix = value.length > 3 ? ', ...' + value.length + ' items' : ''
  const s = '[' + items.join(', ') + suffix + ']'
  return s.length > maxLen ? '[' + value.length + ' items]' : s
}

/**
 * Create a compact preview of a plain object value.
 * Shows first 4 key-value pairs with a summary for larger objects.
 *
 * @param value  - The object to preview.
 * @param maxLen - Maximum preview string length before falling back to keys-only.
 * @param recurse - Function to recursively preview nested values.
 */
export function previewObject(
  value: Record<string, unknown>,
  maxLen: number,
  recurse: (v: unknown, max: number) => string
): string {
  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  const pairs: string[] = []
  for (let i = 0; i < Math.min(keys.length, 4); i++) {
    pairs.push(keys[i] + ': ' + recurse(value[keys[i]], 30))
  }
  const suffix = keys.length > 4 ? ', ...+' + (keys.length - 4) : ''
  const s = '{ ' + pairs.join(', ') + suffix + ' }'
  if (s.length <= maxLen) return s
  const keySummary = keys.slice(0, 6).join(', ') + (keys.length > 6 ? ', ...' : '')
  return '{ ' + keySummary + ' }'
}
