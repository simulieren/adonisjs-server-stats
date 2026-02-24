import type { ApplicationService } from '@adonisjs/core/types'

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface RedactedValue {
  __redacted: true
  display: string
  value: string
}

export interface SanitizedConfig {
  /** App configuration from `app.config.all()` with secrets redacted. */
  config: Record<string, any>
}

export interface SanitizedEnvVars {
  /** Environment variables from `process.env` with secrets redacted. */
  env: Record<string, string | RedactedValue>
}

// ---------------------------------------------------------------------------
// Sensitive key patterns
// ---------------------------------------------------------------------------

/**
 * Patterns matched against key names (case-insensitive) to detect secrets.
 *
 * Uses `(?:^|[_.-])` and `(?:$|[_.-])` as boundaries instead of `\b`
 * because env vars use `_` as separators and `_` is a word character
 * in regex, so `\b` won't match between `CLIENT` and `SECRET` in
 * `GOOGLE_CLIENT_SECRET`.
 */
const B = '(?:^|[_.\\-])'  // boundary before
const A = '(?:$|[_.\\-])'  // boundary after

const SENSITIVE_PATTERNS: RegExp[] = [
  new RegExp(`${B}password${A}`, 'i'),
  new RegExp(`${B}secret${A}`, 'i'),
  new RegExp(`${B}token${A}`, 'i'),
  new RegExp(`${B}credential${A}`, 'i'),
  new RegExp(`${B}private${A}`, 'i'),
  new RegExp(`${B}auth${A}`, 'i'),
  // API keys: `api_key`, `apiKey`, `API_KEY`
  /api[_-]?key/i,
  // `_KEY` at end or `_KEY_` in middle (AWS_ACCESS_KEY_ID, ENCRYPTION_KEY, etc.)
  /[_-]key([_-]|$)/i,
  // ACCESS_KEY pattern (AWS credentials)
  /access[_-]?key/i,
  // Exact match for just "key" (standalone)
  /^key$/i,
  // Connection strings and DSNs
  new RegExp(`${B}dsn${A}`, 'i'),
  /connection[_-]?string/i,
  // Email addresses in env var names
  new RegExp(`${B}email${A}`, 'i'),
  new RegExp(`${B}smtp${A}`, 'i'),
  // Database/service URLs (often contain embedded credentials)
  /database[_-]?url/i,
  /redis[_-]?url/i,
  // Webhook secrets
  /webhook[_-]?secret/i,
  // Signing / encryption
  new RegExp(`${B}signing${A}`, 'i'),
  new RegExp(`${B}encryption${A}`, 'i'),
  // App key / app secret
  /app[_-]key/i,
]

const REDACTED_DISPLAY = '••••••••'

function redact(value: string): RedactedValue {
  return { __redacted: true, display: REDACTED_DISPLAY, value }
}

// ---------------------------------------------------------------------------
// ConfigInspector
// ---------------------------------------------------------------------------

/**
 * Reads and sanitizes application configuration and environment variables.
 *
 * Designed for the full-page dashboard's Config section.
 * Automatically redacts values whose keys match sensitive patterns.
 */
export class ConfigInspector {
  constructor(private app: ApplicationService) {}

  /**
   * Get the full application config with sensitive values redacted.
   */
  getConfig(): SanitizedConfig {
    try {
      const raw = (this.app as any).config?.all?.() ?? {}
      return { config: sanitizeObject(raw) }
    } catch {
      return { config: {} }
    }
  }

  /**
   * Get environment variables with sensitive values redacted.
   */
  getEnvVars(): SanitizedEnvVars {
    try {
      const env: Record<string, string | RedactedValue> = {}
      const sorted = Object.keys(process.env).sort()
      for (const key of sorted) {
        const value = process.env[key]
        if (value === undefined) continue

        if (isSensitiveKey(key) || isSensitiveValue(value)) {
          env[key] = redact(value)
        } else {
          env[key] = value
        }
      }
      return { env }
    } catch {
      return { env: {} }
    }
  }
}

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

/**
 * Check if a key name matches any sensitive pattern.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))
}

/**
 * Check if a value looks sensitive based on its content.
 * Catches email addresses and URLs with embedded credentials.
 */
function isSensitiveValue(value: string): boolean {
  // Email addresses
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true
  // URLs with userinfo (credentials embedded in URL)
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*:[^/]*@/i.test(value)) return true
  return false
}

/**
 * Recursively sanitize an object, redacting string values whose keys
 * match sensitive patterns. Booleans and numbers are never redacted.
 */
function sanitizeObject(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined) return obj

  // Primitive types pass through
  if (typeof obj !== 'object') return obj

  // Avoid circular references
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, seen))
  }

  const result: Record<string, any> = {}
  for (const key of Object.keys(obj)) {
    const value = obj[key]

    if (typeof value === 'string' && (isSensitiveKey(key) || isSensitiveValue(value))) {
      result[key] = redact(value)
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value, seen)
    } else {
      // Booleans, numbers, and non-sensitive strings pass through
      result[key] = value
    }
  }
  return result
}
