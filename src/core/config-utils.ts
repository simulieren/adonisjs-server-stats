// ---------------------------------------------------------------------------
// Config utility functions
// ---------------------------------------------------------------------------
//
// Pure functions for working with config data structures. Extracted from
// src/react/components/shared/ConfigContent.tsx (source of truth) so both
// React and Vue can share the same logic.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedactedValue {
  __redacted: true
  display: string
  value: string
}

export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RedactedValue
  | ConfigValue[]
  | { [key: string]: ConfigValue }

export interface FlatEntry {
  path: string
  value: ConfigValue
}

export interface FormattedValue {
  text: string
  color?: string
}

// ---------------------------------------------------------------------------
// Redacted value detection
// ---------------------------------------------------------------------------

/**
 * Check whether a config value is a server-redacted object.
 *
 * Redacted objects have the shape `{ __redacted: true, display: string, value: string }`.
 */
export function isRedactedValue(val: ConfigValue): val is RedactedValue {
  return (
    val !== null &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    (val as Record<string, unknown>).__redacted === true
  )
}

// ---------------------------------------------------------------------------
// Flatten config
// ---------------------------------------------------------------------------

/**
 * Recursively flatten a nested config object into a list of dot-path entries.
 *
 * Objects are recursed into; arrays, redacted values, and primitives are
 * treated as leaf entries.
 *
 * @param obj    - The config value to flatten.
 * @param prefix - Dot-path prefix for keys (default `''`).
 */
export function flattenConfig(obj: ConfigValue, prefix: string = ''): FlatEntry[] {
  if (typeof obj !== 'object' || obj === null || obj === undefined) {
    return [{ path: prefix, value: obj }]
  }
  if (Array.isArray(obj) || isRedactedValue(obj)) {
    return [{ path: prefix, value: obj }]
  }
  const results: FlatEntry[] = []
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key
    const val = (obj as Record<string, ConfigValue>)[key]
    if (
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val) &&
      !isRedactedValue(val)
    ) {
      results.push(...flattenConfig(val, fullPath))
    } else {
      results.push({ path: fullPath, value: val })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Format flat value
// ---------------------------------------------------------------------------

/**
 * Format a leaf config value for display, returning both text and an
 * optional CSS color string.
 *
 * - `null` / `undefined` -> `"null"` (dim)
 * - `boolean` -> `"true"` (green) / `"false"` (red)
 * - `number` -> stringified (amber)
 * - `array` -> comma-separated items in brackets (purple)
 * - `object` -> JSON string (dim)
 * - `string` -> as-is (no color)
 */
export function formatFlatValue(value: ConfigValue): FormattedValue {
  if (value === null || value === undefined)
    return { text: 'null', color: 'var(--ss-dim)' }
  if (typeof value === 'boolean')
    return {
      text: String(value),
      color: value ? 'var(--ss-green-fg)' : 'var(--ss-red-fg)',
    }
  if (typeof value === 'number')
    return { text: String(value), color: 'var(--ss-amber-fg)' }
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === null || item === undefined) return 'null'
      if (typeof item === 'object') return JSON.stringify(item)
      return String(item)
    })
    return { text: `[${items.join(', ')}]`, color: 'var(--ss-purple-fg)' }
  }
  if (typeof value === 'object')
    return { text: JSON.stringify(value), color: 'var(--ss-dim)' }
  return { text: String(value) }
}

// ---------------------------------------------------------------------------
// Count leaves
// ---------------------------------------------------------------------------

/**
 * Count the number of leaf entries in a (possibly nested) config object.
 *
 * Primitives, arrays, and redacted objects each count as 1.
 */
export function countLeaves(obj: ConfigValue): number {
  if (
    obj === null ||
    obj === undefined ||
    typeof obj !== 'object' ||
    Array.isArray(obj) ||
    isRedactedValue(obj)
  ) {
    return 1
  }
  let count = 0
  for (const key of Object.keys(obj)) {
    count += countLeaves((obj as Record<string, ConfigValue>)[key])
  }
  return count
}

// ---------------------------------------------------------------------------
// Collect top-level object keys
// ---------------------------------------------------------------------------

/**
 * Return the keys of top-level properties that are plain objects
 * (i.e. collapsible sections in the config tree).
 *
 * Useful for "Expand All" / "Collapse All" functionality.
 */
export function collectTopLevelObjectKeys(obj: ConfigValue): string[] {
  if (
    obj === null ||
    obj === undefined ||
    typeof obj !== 'object' ||
    Array.isArray(obj) ||
    isRedactedValue(obj)
  ) {
    return []
  }
  const keys: string[] = []
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, ConfigValue>)[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !isRedactedValue(value)
    ) {
      keys.push(key)
    }
  }
  return keys
}

// ---------------------------------------------------------------------------
// Search matching
// ---------------------------------------------------------------------------

/**
 * Check if a config entry's key or stringified value matches a search term.
 *
 * Matching is case-insensitive. Redacted values are matched against their
 * display string.
 *
 * @param key        - The config key (or dot-path).
 * @param value      - The config value.
 * @param searchTerm - Lowercased search term.
 */
export function matchesConfigSearch(
  key: string,
  value: ConfigValue,
  searchTerm: string
): boolean {
  if (!searchTerm) return true
  if (key.toLowerCase().includes(searchTerm)) return true
  const strVal = isRedactedValue(value)
    ? value.display
    : value === null || value === undefined
      ? ''
      : String(value)
  return strVal.toLowerCase().includes(searchTerm)
}

// ---------------------------------------------------------------------------
// Copy with feedback
// ---------------------------------------------------------------------------

/**
 * Copy text to the clipboard and briefly show a checkmark on the button.
 *
 * This is a DOM-aware helper used by both React and Vue config viewers.
 *
 * @param text   - Text to copy.
 * @param btnRef - The button element to animate (may be `null`).
 * @param prefix - CSS class prefix (e.g. `"ss-dbg"` or `"ss-dash"`).
 */
export function copyWithFeedback(
  text: string,
  btnRef: HTMLButtonElement | null,
  prefix: string
): void {
  if (!btnRef) return
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const prev = btnRef.textContent
      btnRef.textContent = '\u2713'
      btnRef.classList.add(`${prefix}-copy-row-ok`)
      setTimeout(() => {
        btnRef.textContent = prev
        btnRef.classList.remove(`${prefix}-copy-row-ok`)
      }, 1200)
    })
    .catch(() => {
      // Silently fail
    })
}

// ---------------------------------------------------------------------------
// Redaction pattern
// ---------------------------------------------------------------------------

/**
 * Regex pattern matching common secret-like key names.
 *
 * Used by the Vue config viewer for client-side redaction when the server
 * does not provide pre-redacted values.
 */
export const REDACT_PATTERN =
  /secret|password|token|key|api_key|apikey|auth|credential|private/i
