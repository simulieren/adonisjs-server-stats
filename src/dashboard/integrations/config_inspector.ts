import { isSensitiveConfigName, looksLikeCredentialValue } from '../sensitive_patterns.js'

import type { ApplicationService } from '@adonisjs/core/types'

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface RedactedValue {
  __redacted: true
  display: string
}

export interface SanitizedConfig {
  /** App configuration from `app.config.all()` with secrets redacted. */
  config: Record<string, unknown>
}

export interface SanitizedEnvVars {
  /** Environment variables from `process.env` with secrets redacted. */
  env: Record<string, string | RedactedValue>
}

// ---------------------------------------------------------------------------
// Sensitive key detection
// ---------------------------------------------------------------------------

// The name patterns live in `../sensitive_patterns.js` so the config inspector
// and the SQL-binding writer share one definition of "looks like a secret".

const REDACTED_DISPLAY = '••••••••'

function redact(_value: string): RedactedValue {
  // Never include the plaintext value: the redacted object is serialized
  // to the browser, so the secret must not leave the server.
  return { __redacted: true, display: REDACTED_DISPLAY }
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
  private cachedConfig: SanitizedConfig | null = null
  private cachedEnv: SanitizedEnvVars | null = null
  private cacheTimestamp: number = 0
  private static readonly CACHE_TTL_MS = 30_000 // 30 seconds

  constructor(private app: ApplicationService) {}

  /**
   * Get the full application config with sensitive values redacted.
   */
  getConfig(): SanitizedConfig {
    if (this.cachedConfig && Date.now() - this.cacheTimestamp < ConfigInspector.CACHE_TTL_MS) {
      return this.cachedConfig
    }
    try {
      const raw =
        (
          this.app as unknown as { config?: { all?: () => Record<string, unknown> } }
        ).config?.all?.() ?? {}
      this.cachedConfig = { config: sanitizeObject(raw) as Record<string, unknown> }
      this.cacheTimestamp = Date.now()
      return this.cachedConfig
    } catch {
      return { config: {} }
    }
  }

  /**
   * Get environment variables with sensitive values redacted.
   */
  getEnvVars(): SanitizedEnvVars {
    if (this.cachedEnv && Date.now() - this.cacheTimestamp < ConfigInspector.CACHE_TTL_MS) {
      return this.cachedEnv
    }
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
      this.cachedEnv = { env }
      this.cacheTimestamp = Date.now()
      return this.cachedEnv
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
  return isSensitiveConfigName(key)
}

/**
 * Check if a value looks sensitive based on its content.
 * Catches email addresses and URLs with embedded credentials.
 */
function isSensitiveValue(value: string): boolean {
  // Email addresses are config-sensitive (SMTP accounts) even though they are
  // ordinary data as a query binding — hence the check lives here, not in the
  // shared shape helper.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true
  return looksLikeCredentialValue(value)
}

/** Sanitize a single key-value pair, redacting sensitive strings. */
function sanitizeValue(key: string, value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string' && (isSensitiveKey(key) || isSensitiveValue(value))) {
    return redact(value)
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeObject(value, seen)
  }
  return value
}

/**
 * Recursively sanitize an object, redacting string values whose keys
 * match sensitive patterns. Booleans and numbers are never redacted.
 */
function sanitizeObject(obj: unknown, seen = new WeakSet<object>()): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, seen))
  }

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    result[key] = sanitizeValue(key, record[key], seen)
  }
  return result
}
