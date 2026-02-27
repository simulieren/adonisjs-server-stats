/**
 * Shared email address extraction utilities.
 */

/**
 * Normalize various AdonisJS mail address formats to a comma-separated string.
 *
 * Handles:
 * - A string: `"user@example.com"`
 * - An object: `{ address: "user@example.com", name: "User" }`
 * - An array of strings or objects
 */
export function extractAddresses(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((v: unknown) => (typeof v === 'string' ? v : (v as Record<string, unknown>)?.address || ''))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof value === 'object' && (value as Record<string, unknown>).address) return (value as Record<string, unknown>).address as string
  return ''
}
